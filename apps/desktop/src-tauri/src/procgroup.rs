//! Keeps a spawned tool and all of its children (yt-dlp → ffmpeg) together, so
//! cancel kills the whole tree and nothing outlives the app.

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// A Windows job object with "kill on close": dropping it ends every process inside.
    pub struct ProcGroup(usize);

    // The handle is only used through thread-safe Win32 calls.
    unsafe impl Send for ProcGroup {}
    unsafe impl Sync for ProcGroup {}

    impl ProcGroup {
        pub fn new() -> std::io::Result<Self> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                Ok(Self(job as usize))
            }
        }

        pub fn add(&self, child: &tokio::process::Child) {
            if let Some(h) = child.raw_handle() {
                unsafe { AssignProcessToJobObject(self.0 as HANDLE, h as HANDLE) };
            }
        }

        pub fn kill(&self) {
            unsafe { TerminateJobObject(self.0 as HANDLE, 1) };
        }
    }

    impl Drop for ProcGroup {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0 as HANDLE) };
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::sync::atomic::{AtomicI32, Ordering};

    /// On Unix the child is started in its own process group; kill signals the group.
    pub struct ProcGroup(AtomicI32);

    impl ProcGroup {
        pub fn new() -> std::io::Result<Self> {
            Ok(Self(AtomicI32::new(0)))
        }
        pub fn add(&self, child: &tokio::process::Child) {
            if let Some(pid) = child.id() {
                self.0.store(pid as i32, Ordering::SeqCst);
            }
        }
        pub fn kill(&self) {
            let pid = self.0.load(Ordering::SeqCst);
            if pid > 0 {
                let _ = std::process::Command::new("kill").args(["-TERM", &format!("-{pid}")]).status();
            }
        }
    }

    impl Drop for ProcGroup {
        fn drop(&mut self) {
            self.kill();
        }
    }
}

pub use imp::ProcGroup;

/// Makes the command start its own process group on Unix (no-op on Windows).
pub fn isolate(cmd: &mut tokio::process::Command) {
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }
    #[cfg(not(unix))]
    let _ = cmd;
}
