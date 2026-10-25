//! Owns all jobs: analysis, scheduling under the parallel limit, cancel and retry.
//! Every change is pushed to the UI as a `job` event with the full job.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};

use crate::model::{DownloadOptions, Job, JobError, JobStatus, Progress};
use crate::procgroup::ProcGroup;
use crate::{download, probe, AppState};

struct Running {
    group: Arc<ProcGroup>,
    canceled: Arc<AtomicBool>,
}

#[derive(Default)]
struct Inner {
    jobs: Vec<Job>,
    running: HashMap<String, Running>,
}

pub struct Queue {
    app: AppHandle,
    inner: Mutex<Inner>,
}

impl Queue {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self { app, inner: Mutex::new(Inner::default()) })
    }

    pub fn snapshot(&self) -> Vec<Job> {
        self.inner.lock().unwrap().jobs.clone()
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
        let _ = self.app.emit("job", &job);
        Some(job)
    }

    pub fn add(self: &Arc<Self>, url: String) -> Job {
        let job = Job {
            id: uuid::Uuid::new_v4().to_string(),
            url,
            created_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            status: JobStatus::Analyzing,
            media: None,
            options: None,
            progress: Progress::default(),
            error: None,
            outputs: Vec::new(),
        };
        self.inner.lock().unwrap().jobs.insert(0, job.clone());
        let _ = self.app.emit("job", &job);
        self.spawn_probe(job.id.clone());
        job
    }

    fn spawn_probe(self: &Arc<Self>, id: String) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let Some(job) = this.get(&id) else { return };
            let state = this.app.state::<AppState>();
            let proxy = state.settings.read().unwrap().proxy.clone();
            let result = match &state.tools {
                Ok(tools) => probe::probe(tools, &proxy, &job.url).await,
                Err(e) => Err(JobError { code: "tool_missing".into(), detail: e.clone() }),
            };
            this.update(&id, |j| {
                if j.status != JobStatus::Analyzing {
                    return; // canceled meanwhile
                }
                match result {
                    Ok(media) => {
                        j.media = Some(media);
                        j.status = JobStatus::Ready;
                    }
                    Err(e) => {
                        j.error = Some(e);
                        j.status = JobStatus::Error;
                    }
                }
            });
        });
    }

    pub fn set_options(&self, id: &str, options: DownloadOptions) -> Option<Job> {
        self.update(id, |j| j.options = Some(options))
    }

    pub fn start(self: &Arc<Self>, id: &str, options: DownloadOptions) -> Result<Job, String> {
        let job = self
            .update(id, |j| {
                if matches!(j.status, JobStatus::Ready | JobStatus::Error | JobStatus::Canceled | JobStatus::Done) && j.media.is_some() {
                    j.options = Some(options);
                    j.status = JobStatus::Queued;
                    j.progress = Progress::default();
                    j.error = None;
                    j.outputs.clear();
                }
            })
            .ok_or("Загрузка не найдена")?;
        if job.status != JobStatus::Queued {
            return Err("Эту загрузку сейчас нельзя запустить".into());
        }
        self.pump();
        Ok(job)
    }

    pub fn retry(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let job = self.get(id).ok_or("Загрузка не найдена")?;
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

    pub fn cancel(&self, id: &str) {
        let running = self.inner.lock().unwrap().running.get(id).map(|r| (r.group.clone(), r.canceled.clone()));
        if let Some((group, canceled)) = running {
            canceled.store(true, Ordering::SeqCst);
            group.kill();
        } else {
            self.update(id, |j| {
                if matches!(j.status, JobStatus::Queued | JobStatus::Analyzing) {
                    j.status = JobStatus::Canceled;
                }
            });
        }
    }

    pub fn remove(&self, id: &str) {
        self.cancel(id);
        self.inner.lock().unwrap().jobs.retain(|j| j.id != id);
        let _ = self.app.emit("job-removed", id);
    }

    pub fn clear_finished(&self) {
        let removed: Vec<String> = {
            let mut inner = self.inner.lock().unwrap();
            let ids = inner.jobs.iter().filter(|j| j.status == JobStatus::Done).map(|j| j.id.clone()).collect();
            inner.jobs.retain(|j| j.status != JobStatus::Done);
            ids
        };
        for id in removed {
            let _ = self.app.emit("job-removed", &id);
        }
    }

    pub fn cancel_all(&self) {
        let ids: Vec<String> = self.inner.lock().unwrap().running.keys().cloned().collect();
        for id in ids {
            self.cancel(&id);
        }
    }

    /// Starts queued jobs while there is room under the parallel limit.
    pub fn pump(self: &Arc<Self>) {
        let limit = self.app.state::<AppState>().settings.read().unwrap().max_parallel as usize;
        let starting: Vec<(Job, Arc<ProcGroup>, Arc<AtomicBool>)> = {
            let mut inner = self.inner.lock().unwrap();
            let free = limit.saturating_sub(inner.running.len());
            // Oldest first: jobs are stored newest first.
            let ids: Vec<String> = inner.jobs.iter().rev().filter(|j| j.status == JobStatus::Queued).take(free).map(|j| j.id.clone()).collect();
            let mut out = Vec::new();
            for id in ids {
                let Ok(group) = ProcGroup::new() else { continue };
                let group = Arc::new(group);
                let canceled = Arc::new(AtomicBool::new(false));
                inner.running.insert(id.clone(), Running { group: group.clone(), canceled: canceled.clone() });
                if let Some(j) = inner.jobs.iter_mut().find(|j| j.id == id) {
                    j.status = JobStatus::Downloading;
                    j.progress = Progress { stage: Some("download".into()), ..Default::default() };
                    out.push((j.clone(), group, canceled));
                }
            }
            out
        };
        for (job, group, canceled) in starting {
            let _ = self.app.emit("job", &job);
            let this = self.clone();
            tauri::async_runtime::spawn(async move { this.run_job(job, group, canceled).await });
        }
    }

    async fn run_job(self: Arc<Self>, job: Job, group: Arc<ProcGroup>, canceled: Arc<AtomicBool>) {
        let state = self.app.state::<AppState>();
        let settings = state.settings.read().unwrap().clone();
        let result = match &state.tools {
            Err(e) => Err(JobError { code: "tool_missing".into(), detail: e.clone() }),
            Ok(tools) => {
                if let Err(e) = std::fs::create_dir_all(&settings.download_dir) {
                    Err(JobError { code: "folder".into(), detail: e.to_string() })
                } else {
                    let options = job.options.clone().unwrap_or_default();
                    let spec = download::build(tools, &settings, &job.url, job.media.as_ref(), &options);
                    let mut last = Instant::now() - Duration::from_secs(1);
                    let id = job.id.clone();
                    let this = self.clone();
                    download::run(&tools.ytdlp, spec, group, move |p, force| {
                        if force || last.elapsed() >= Duration::from_millis(150) {
                            last = Instant::now();
                            let p = p.clone();
                            this.update(&id, |j| {
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
        let was_canceled = canceled.load(Ordering::SeqCst);
        self.update(&job.id, |j| match result {
            _ if was_canceled => {
                j.status = JobStatus::Canceled;
                j.progress.speed = None;
                j.progress.eta = None;
            }
            Ok(outputs) => {
                j.status = JobStatus::Done;
                j.progress.fraction = Some(1.0);
                j.progress.speed = None;
                j.progress.eta = None;
                j.progress.stage = None;
                j.outputs = outputs;
            }
            Err(e) => {
                j.status = JobStatus::Error;
                j.error = Some(e);
                j.progress.speed = None;
                j.progress.eta = None;
            }
        });
        self.pump();
    }
}
