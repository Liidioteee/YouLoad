//! Owns all jobs and the download history: analysis, scheduling under the parallel
//! limit, pause/resume, cancel, retry, and saving everything between launches.
//! Every change is pushed to the UI as a `job` event with the full job.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::log;
use crate::model::{DownloadOptions, HistoryItem, Job, JobError, JobStatus, MediaKind, Progress};
use crate::procgroup::ProcGroup;
use crate::tools::command;
use crate::{download, notify, probe, AppState};

const STOP_NONE: u8 = 0;
const STOP_CANCEL: u8 = 1;
const STOP_PAUSE: u8 = 2;

struct Running {
    group: Arc<ProcGroup>,
    stop: Arc<AtomicU8>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct HistoryFile {
    items: Vec<HistoryItem>,
    downloaded_ids: Vec<String>,
}

#[derive(Default)]
struct Inner {
    jobs: Vec<Job>,
    running: HashMap<String, Running>,
    history: Vec<HistoryItem>,
    downloaded: HashSet<String>,
}

pub struct Queue {
    app: AppHandle,
    inner: Mutex<Inner>,
    data_dir: PathBuf,
    partial_dir: PathBuf,
    dirty: AtomicBool,
}

impl Queue {
    pub fn new(app: AppHandle, data_dir: PathBuf, partial_dir: PathBuf) -> Arc<Self> {
        let mut inner = Inner::default();
        if let Ok(text) = std::fs::read_to_string(data_dir.join("jobs.json")) {
            inner.jobs = serde_json::from_str(&text).unwrap_or_default();
        }
        if let Ok(text) = std::fs::read_to_string(data_dir.join("history.json")) {
            let h: HistoryFile = serde_json::from_str(&text).unwrap_or_default();
            inner.history = h.items;
            inner.downloaded = h.downloaded_ids.into_iter().collect();
        }
        // Whatever was running when the app closed can continue from where it stopped.
        for j in &mut inner.jobs {
            if matches!(j.status, JobStatus::Downloading | JobStatus::Processing | JobStatus::Queued) {
                j.status = JobStatus::Paused;
                j.progress.speed = None;
                j.progress.eta = None;
            }
        }
        let q = Arc::new(Self { app, inner: Mutex::new(inner), data_dir, partial_dir, dirty: AtomicBool::new(false) });
        let to_probe: Vec<String> = q.inner.lock().unwrap().jobs.iter().filter(|j| j.status == JobStatus::Analyzing).map(|j| j.id.clone()).collect();
        for id in to_probe {
            q.spawn_probe(id);
        }
        q
    }

    /// Writes jobs and history at most once a second, only when something changed.
    pub fn start_autosave(self: &Arc<Self>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                if this.dirty.swap(false, Ordering::SeqCst) {
                    this.flush();
                }
            }
        });
    }

    pub fn flush(&self) {
        let (jobs, history) = {
            let inner = self.inner.lock().unwrap();
            // Finished jobs live on in history; drop their heavy format lists.
            let jobs: Vec<Job> = inner
                .jobs
                .iter()
                .map(|j| {
                    let mut j = j.clone();
                    if j.status == JobStatus::Done {
                        if let Some(m) = j.media.as_mut() {
                            m.formats.clear();
                            m.subtitles.clear();
                            for e in &mut m.entries {
                                e.formats = None;
                            }
                        }
                    }
                    j
                })
                .collect();
            let history = HistoryFile { items: inner.history.clone(), downloaded_ids: inner.downloaded.iter().cloned().collect() };
            (jobs, history)
        };
        let _ = std::fs::create_dir_all(&self.data_dir);
        for (name, bytes) in [("jobs.json", serde_json::to_vec(&jobs)), ("history.json", serde_json::to_vec(&history))] {
            let Ok(bytes) = bytes else { continue };
            let path = self.data_dir.join(name);
            let tmp = path.with_extension("tmp");
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
    }

    fn touch(&self) {
        self.dirty.store(true, Ordering::SeqCst);
    }

    pub fn snapshot(&self) -> Vec<Job> {
        self.inner.lock().unwrap().jobs.clone()
    }

    pub fn history(&self) -> Vec<HistoryItem> {
        self.inner.lock().unwrap().history.clone()
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.inner.lock().unwrap().jobs.iter().find(|j| j.id == id).cloned()
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut Job)) -> Option<Job> {
        let job = {
            let mut inner = self.inner.lock().unwrap();
            let job = inner.jobs.iter_mut().find(|j| j.id == id)?;
            f(job);
            job.clone()
        };
        self.touch();
        let _ = self.app.emit("job", &job);
        Some(job)
    }

    pub fn add(self: &Arc<Self>, url: String) -> Job {
        let job = Job {
            id: uuid::Uuid::new_v4().to_string(),
            url,
            created_at: log::now_ms(),
            status: JobStatus::Analyzing,
            media: None,
            options: None,
            progress: Progress::default(),
            error: None,
            outputs: Vec::new(),
            done_ids: Vec::new(),
            finished_at: None,
            size: None,
        };
        self.inner.lock().unwrap().jobs.insert(0, job.clone());
        self.touch();
        let _ = self.app.emit("job", &job);
        self.spawn_probe(job.id.clone());
        job
    }

    /// True if a job for this exact link is already in the list.
    pub fn has_url(&self, url: &str) -> bool {
        self.inner.lock().unwrap().jobs.iter().any(|j| j.url == url)
    }

    fn spawn_probe(self: &Arc<Self>, id: String) {
        self.spawn_probe_url(id, None);
    }

    /// Analyzes the job's link, or `target` (another channel tab). For a tab switch the
    /// current media stays until the new one arrives, and stays if the tab is missing.
    fn spawn_probe_url(self: &Arc<Self>, id: String, target: Option<String>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let Some(job) = this.get(&id) else { return };
            let url = target.clone().unwrap_or_else(|| job.url.clone());
            let state = this.app.state::<AppState>();
            let result = match state.ytdlp() {
                Ok((tools, args)) => probe::probe(&tools, &args, &url).await,
                Err(e) => Err(e),
            };
            if let Err(e) = &result {
                log::warn("probe", format!("{url} → {}: {}", e.code, e.detail));
            }
            let downloaded = this.inner.lock().unwrap().downloaded.clone();
            this.update(&id, |j| {
                if j.status != JobStatus::Analyzing {
                    return; // canceled meanwhile
                }
                match result {
                    Ok(mut media) => {
                        for e in &mut media.entries {
                            e.downloaded = downloaded.contains(&e.id);
                        }
                        if let Some(u) = &target {
                            j.url = u.clone();
                            j.options = None;
                        }
                        j.media = Some(media);
                        j.error = None;
                        j.status = JobStatus::Ready;
                    }
                    Err(e) if target.is_some() && j.media.is_some() => {
                        // The tab does not exist or failed: keep the tab we had.
                        j.error = Some(e);
                        j.status = JobStatus::Ready;
                    }
                    Err(e) => {
                        j.error = Some(e);
                        j.status = JobStatus::Error;
                    }
                }
            });
            let scan = this
                .get(&id)
                .filter(|j| j.status == JobStatus::Ready)
                .and_then(|j| j.media)
                .filter(|m| m.kind == MediaKind::Playlist)
                .map(|m| m.url);
            if let Some(media_url) = scan {
                this.scan_sizes(id, media_url);
            }
        });
    }

    /// Fetches the formats of every playlist video in the background (3 yt-dlp processes,
    /// 6 videos each) so the UI can estimate the total size before the download.
    fn scan_sizes(self: &Arc<Self>, id: String, media_url: String) {
        let Some(media) = self.get(&id).and_then(|j| j.media) else { return };
        let todo: Vec<String> = media.entries.iter().filter(|e| e.formats.is_none()).map(|e| e.url.clone()).collect();
        let sem = Arc::new(tokio::sync::Semaphore::new(3));
        for chunk in todo.chunks(6).map(<[String]>::to_vec) {
            let (this, id, media_url, sem) = (self.clone(), id.clone(), media_url.clone(), sem.clone());
            tauri::async_runtime::spawn(async move {
                let Ok(_permit) = sem.acquire_owned().await else { return };
                if !this.scan_wanted(&id, &media_url) {
                    return;
                }
                let Ok((tools, args)) = this.app.state::<AppState>().ytdlp() else { return };
                let mut cmd = command(&tools.ytdlp);
                cmd.args(&args)
                    .args(["--skip-download", "--no-warnings", "--ignore-errors", "--no-playlist", "--print"])
                    .arg(format!("YLSZ|%(id)s|%(formats.:.{{{}}})j", probe::SCAN_FIELDS))
                    .arg("--")
                    .args(&chunk)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null());
                let mut found: HashMap<String, Vec<crate::model::Format>> = HashMap::new();
                if let Ok(mut child) = cmd.spawn() {
                    if let Some(out) = child.stdout.take() {
                        let mut lines = BufReader::new(out).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            if let Some((vid, formats)) = line.strip_prefix("YLSZ|").and_then(probe::parse_scan_line) {
                                found.insert(vid, formats);
                            }
                        }
                    }
                    let _ = child.wait().await;
                }
                if !this.scan_wanted(&id, &media_url) {
                    return;
                }
                this.update(&id, |j| {
                    let Some(m) = j.media.as_mut().filter(|m| m.url == media_url) else { return };
                    for e in m.entries.iter_mut().filter(|e| chunk.contains(&e.url)) {
                        // Private or removed videos get an empty list so the estimate does not wait for them.
                        e.formats = Some(found.remove(&e.id).unwrap_or_default());
                    }
                });
            });
        }
    }

    fn scan_wanted(&self, id: &str, media_url: &str) -> bool {
        let inner = self.inner.lock().unwrap();
        inner.jobs.iter().any(|j| j.id == id && j.status != JobStatus::Done && j.media.as_ref().is_some_and(|m| m.url == media_url))
    }

    /// Re-analyzes a channel job on another tab: "videos" | "shorts" | "streams".
    pub fn switch_tab(self: &Arc<Self>, id: &str, tab: &str) -> Result<(), String> {
        if !probe::CHANNEL_TABS.contains(&tab) {
            return Err("cannot_start".into());
        }
        let job = self.get(id).ok_or("job_not_found")?;
        let (base, _) = probe::channel_parts(&job.url).ok_or("cannot_start")?;
        if job.status.is_active() || matches!(job.status, JobStatus::Queued | JobStatus::Analyzing | JobStatus::Paused) {
            return Err("cannot_start".into());
        }
        self.update(id, |j| {
            j.status = JobStatus::Analyzing;
            j.error = None;
        });
        self.spawn_probe_url(id.to_string(), Some(probe::channel_tab_url(&base, tab)));
        Ok(())
    }

    pub fn set_options(&self, id: &str, options: DownloadOptions) -> Option<Job> {
        self.update(id, |j| j.options = Some(options))
    }

    pub fn start(self: &Arc<Self>, id: &str, options: DownloadOptions) -> Result<Job, String> {
        let job = self
            .update(id, |j| {
                if matches!(j.status, JobStatus::Ready | JobStatus::Error | JobStatus::Canceled | JobStatus::Done | JobStatus::Paused) && j.media.is_some() {
                    j.options = Some(options);
                    j.status = JobStatus::Queued;
                    j.progress = Progress::default();
                    j.error = None;
                    j.outputs.clear();
                    j.done_ids.clear();
                    j.finished_at = None;
                    j.size = None;
                }
            })
            .ok_or("job_not_found")?;
        if job.status != JobStatus::Queued {
            return Err("cannot_start".into());
        }
        self.pump();
        Ok(job)
    }

    /// Continues a paused job with the same choices; partial files are reused.
    pub fn resume(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let job = self.get(id).ok_or("job_not_found")?;
        if job.status != JobStatus::Paused {
            return Ok(());
        }
        self.update(id, |j| {
            j.status = JobStatus::Queued;
            j.progress.speed = None;
        });
        self.pump();
        Ok(())
    }

    pub fn retry(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let job = self.get(id).ok_or("job_not_found")?;
        if job.status.is_active() || job.status == JobStatus::Queued {
            return Ok(());
        }
        match (job.media, job.options) {
            (Some(_), Some(options)) => self.start(id, options).map(|_| ()),
            (Some(_), None) => Ok(()),
            (None, _) => {
                self.update(id, |j| {
                    j.status = JobStatus::Analyzing;
                    j.error = None;
                });
                self.spawn_probe(id.to_string());
                Ok(())
            }
        }
    }

    fn stop(&self, id: &str, reason: u8) -> bool {
        let running = self.inner.lock().unwrap().running.get(id).map(|r| (r.group.clone(), r.stop.clone()));
        match running {
            Some((group, stop)) => {
                stop.store(reason, Ordering::SeqCst);
                group.kill();
                true
            }
            None => false,
        }
    }

    pub fn pause(&self, id: &str) {
        if !self.stop(id, STOP_PAUSE) {
            self.update(id, |j| {
                if j.status == JobStatus::Queued {
                    j.status = JobStatus::Paused;
                }
            });
        }
    }

    pub fn cancel(&self, id: &str) {
        if !self.stop(id, STOP_CANCEL) {
            self.update(id, |j| {
                if matches!(j.status, JobStatus::Queued | JobStatus::Analyzing | JobStatus::Paused) {
                    j.status = JobStatus::Canceled;
                }
            });
            self.remove_partial(id);
        }
    }

    pub fn remove(&self, id: &str) {
        self.cancel(id);
        self.inner.lock().unwrap().jobs.retain(|j| j.id != id);
        self.touch();
        let _ = self.app.emit("job-removed", id);
    }

    pub fn clear_finished(&self) {
        let removed: Vec<String> = {
            let mut inner = self.inner.lock().unwrap();
            let ids = inner.jobs.iter().filter(|j| j.status == JobStatus::Done).map(|j| j.id.clone()).collect();
            inner.jobs.retain(|j| j.status != JobStatus::Done);
            ids
        };
        self.touch();
        for id in removed {
            let _ = self.app.emit("job-removed", &id);
        }
    }

    pub fn history_item(&self, id: &str) -> Option<HistoryItem> {
        self.inner.lock().unwrap().history.iter().find(|h| h.id == id).cloned()
    }

    pub fn remove_history(&self, id: &str) {
        self.inner.lock().unwrap().history.retain(|h| h.id != id);
        self.touch();
        let _ = self.app.emit("history", self.history());
    }

    /// Forgets the list; files on disk stay. "Only new" marks reset too.
    pub fn clear_history(&self) {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.history.clear();
            inner.downloaded.clear();
        }
        self.touch();
        let _ = self.app.emit("history", Vec::<HistoryItem>::new());
    }

    /// App exit: running downloads become paused so they continue next time.
    pub fn shutdown(&self) {
        let groups: Vec<Arc<ProcGroup>> = {
            let mut inner = self.inner.lock().unwrap();
            for r in inner.running.values() {
                r.stop.store(STOP_PAUSE, Ordering::SeqCst);
            }
            for j in &mut inner.jobs {
                if matches!(j.status, JobStatus::Downloading | JobStatus::Processing | JobStatus::Queued) {
                    j.status = JobStatus::Paused;
                    j.progress.speed = None;
                    j.progress.eta = None;
                }
            }
            inner.running.values().map(|r| r.group.clone()).collect()
        };
        for g in groups {
            g.kill();
        }
        self.flush();
    }

    pub fn active_count(&self) -> usize {
        self.inner.lock().unwrap().running.len()
    }

    fn partial_path(&self, id: &str) -> PathBuf {
        self.partial_dir.join(id)
    }

    fn remove_partial(&self, id: &str) {
        let _ = std::fs::remove_dir_all(self.partial_path(id));
    }

    /// Starts queued jobs while there is room under the parallel limit.
    pub fn pump(self: &Arc<Self>) {
        let limit = self.app.state::<AppState>().settings.read().unwrap().max_parallel as usize;
        let starting: Vec<(Job, Arc<ProcGroup>, Arc<AtomicU8>)> = {
            let mut inner = self.inner.lock().unwrap();
            let free = limit.saturating_sub(inner.running.len());
            // Oldest first: jobs are stored newest first.
            let ids: Vec<String> = inner.jobs.iter().rev().filter(|j| j.status == JobStatus::Queued).take(free).map(|j| j.id.clone()).collect();
            let mut out = Vec::new();
            for id in ids {
                let Ok(group) = ProcGroup::new() else { continue };
                let group = Arc::new(group);
                let stop = Arc::new(AtomicU8::new(STOP_NONE));
                inner.running.insert(id.clone(), Running { group: group.clone(), stop: stop.clone() });
                if let Some(j) = inner.jobs.iter_mut().find(|j| j.id == id) {
                    j.status = JobStatus::Downloading;
                    j.progress.stage = Some("download".into());
                    out.push((j.clone(), group, stop));
                }
            }
            out
        };
        for (job, group, stop) in starting {
            self.touch();
            let _ = self.app.emit("job", &job);
            let this = self.clone();
            tauri::async_runtime::spawn(async move { this.run_job(job, group, stop).await });
        }
    }

    async fn run_job(self: Arc<Self>, job: Job, group: Arc<ProcGroup>, stop: Arc<AtomicU8>) {
        let state = self.app.state::<AppState>();
        let settings = state.settings.read().unwrap().clone();
        let temp = self.partial_path(&job.id);
        let title = job.media.as_ref().map(|m| m.title.clone()).unwrap_or_else(|| job.url.clone());
        let source: String = title.chars().take(40).collect();
        log::info("queue", format!("start: {title}"));

        let result = match state.ytdlp() {
            Err(e) => Err(e),
            Ok((tools, args)) => {
                if let Err(e) = std::fs::create_dir_all(&settings.download_dir).and_then(|_| std::fs::create_dir_all(&temp)) {
                    Err(JobError { code: "folder".into(), detail: e.to_string() })
                } else {
                    let options = job.options.clone().unwrap_or_default();
                    let spec = download::build(&args, &settings, &temp, &job.url, job.media.as_ref(), &options);
                    let mut last = Instant::now() - Duration::from_secs(1);
                    let id = job.id.clone();
                    let this = self.clone();
                    download::run(&tools.ytdlp, spec, group, &source, move |p, force| {
                        if force || last.elapsed() >= Duration::from_millis(150) {
                            last = Instant::now();
                            let p = p.clone();
                            this.update(&id, |j| {
                                if j.status == JobStatus::Paused {
                                    return;
                                }
                                j.status = if p.stage.as_deref() == Some("download") { JobStatus::Downloading } else { JobStatus::Processing };
                                j.progress = p;
                            });
                        }
                    })
                    .await
                }
            }
        };
        self.inner.lock().unwrap().running.remove(&job.id);
        let reason = stop.load(Ordering::SeqCst);
        let finished = self.update(&job.id, |j| {
            j.progress.speed = None;
            j.progress.eta = None;
            match &result {
                _ if reason == STOP_PAUSE => j.status = JobStatus::Paused,
                _ if reason == STOP_CANCEL => j.status = JobStatus::Canceled,
                Ok(out) => {
                    j.status = JobStatus::Done;
                    j.progress.fraction = Some(1.0);
                    j.progress.stage = None;
                    j.outputs = out.files.clone();
                    j.done_ids = out.ids.clone();
                    j.finished_at = Some(log::now_ms());
                    let size: u64 = out.files.iter().filter_map(|f| std::fs::metadata(f).ok()).map(|m| m.len()).sum();
                    j.size = (size > 0).then_some(size);
                }
                Err(e) => {
                    j.status = JobStatus::Error;
                    j.error = Some(e.clone());
                }
            }
        });
        if reason == STOP_CANCEL || result.is_ok() {
            self.remove_partial(&job.id);
        }
        if let Some(j) = finished {
            match j.status {
                JobStatus::Done => {
                    log::info("queue", format!("done: {title} ({} files)", j.outputs.len()));
                    self.record_history(&j);
                    notify::job_finished(&self.app, &j);
                }
                JobStatus::Error => {
                    log::error("queue", format!("failed: {title}"));
                    notify::job_finished(&self.app, &j);
                }
                _ => {}
            }
        }
        self.pump();
    }

    fn record_history(&self, j: &Job) {
        let Some(m) = &j.media else { return };
        let item = HistoryItem {
            id: uuid::Uuid::new_v4().to_string(),
            url: j.url.clone(),
            kind: m.kind,
            video_id: m.id.clone(),
            title: m.title.clone(),
            channel: m.channel.clone(),
            duration: m.duration,
            finished_at: j.finished_at.unwrap_or_else(log::now_ms),
            outputs: j.outputs.clone(),
            size: j.size,
            options: j.options.clone(),
            count: j.done_ids.len() as u32,
            thumb_id: if m.kind == MediaKind::Playlist { j.done_ids.first().cloned().or_else(|| m.entries.first().map(|e| e.id.clone())) } else { Some(m.id.clone()) },
        };
        {
            let mut inner = self.inner.lock().unwrap();
            inner.history.insert(0, item);
            for id in &j.done_ids {
                inner.downloaded.insert(id.clone());
            }
            if m.kind == MediaKind::Video {
                inner.downloaded.insert(m.id.clone());
            }
        }
        self.touch();
        let _ = self.app.emit("history", self.history());
    }
}
