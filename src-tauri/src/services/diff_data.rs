use std::collections::HashSet;

use crate::cache::{get_cached_changed_files, get_cached_patch, store_changed_files, store_patch};
use crate::github::run_gh;
use crate::models::{PrPatch, PullRequestDiffBundle};

#[derive(Debug)]
pub struct DiffDataRequest {
    pub repo: String,
    pub number: u32,
    pub head_sha: String,
}

impl DiffDataRequest {
    pub fn new(repo: String, number: u32, head_sha: String) -> Result<Self, String> {
        let repo = repo.trim().to_string();
        let head_sha = head_sha.trim().to_string();

        if repo.is_empty() {
            return Err("Repo is required".into());
        }
        if head_sha.is_empty() {
            return Err("Head SHA is required".into());
        }

        Ok(Self {
            repo,
            number,
            head_sha,
        })
    }
}

pub trait DiffSource: Send + Sync {
    fn fetch_patch(&self, repo: &str, number: u32) -> Result<String, String>;
    fn fetch_changed_files_raw(&self, repo: &str, number: u32) -> Result<String, String>;
}

pub trait DiffCache: Send + Sync {
    fn read_patch(&self, repo: &str, number: u32, head_sha: &str) -> Result<Option<String>, String>;
    fn write_patch(&self, repo: &str, number: u32, head_sha: &str, patch: &str)
        -> Result<(), String>;
    fn read_changed_files(
        &self,
        repo: &str,
        number: u32,
        head_sha: &str,
    ) -> Result<Option<Vec<String>>, String>;
    fn write_changed_files(
        &self,
        repo: &str,
        number: u32,
        head_sha: &str,
        files: &[String],
    ) -> Result<(), String>;
}

pub struct DiffDataService<'a> {
    source: &'a dyn DiffSource,
    cache: &'a dyn DiffCache,
}

impl<'a> DiffDataService<'a> {
    pub fn new(source: &'a dyn DiffSource, cache: &'a dyn DiffCache) -> Self {
        Self { source, cache }
    }

    pub fn get_patch(&self, req: &DiffDataRequest) -> Result<PrPatch, String> {
        if let Some(cached_patch) = self.cache.read_patch(&req.repo, req.number, &req.head_sha)? {
            return Ok(PrPatch {
                repo: req.repo.clone(),
                number: req.number,
                head_sha: req.head_sha.clone(),
                patch: cached_patch,
            });
        }

        let patch = self.source.fetch_patch(&req.repo, req.number)?;
        self.cache
            .write_patch(&req.repo, req.number, &req.head_sha, &patch)?;

        Ok(PrPatch {
            repo: req.repo.clone(),
            number: req.number,
            head_sha: req.head_sha.clone(),
            patch,
        })
    }

    pub fn get_changed_files(&self, req: &DiffDataRequest) -> Result<Vec<String>, String> {
        if let Some(files) = self
            .cache
            .read_changed_files(&req.repo, req.number, &req.head_sha)?
        {
            return Ok(files);
        }

        let stdout = self.source.fetch_changed_files_raw(&req.repo, req.number)?;
        let files = normalize_changed_files(&stdout);

        self.cache
            .write_changed_files(&req.repo, req.number, &req.head_sha, &files)?;

        Ok(files)
    }

    pub fn get_diff_bundle(&self, req: &DiffDataRequest) -> Result<PullRequestDiffBundle, String> {
        let cached_patch = self.cache.read_patch(&req.repo, req.number, &req.head_sha)?;
        let cached_files = self
            .cache
            .read_changed_files(&req.repo, req.number, &req.head_sha)?;

        if let (Some(patch), Some(changed_files)) = (cached_patch, cached_files) {
            return Ok(PullRequestDiffBundle {
                repo: req.repo.clone(),
                number: req.number,
                head_sha: req.head_sha.clone(),
                patch,
                changed_files,
            });
        }

        let patch = self.source.fetch_patch(&req.repo, req.number)?;
        let stdout = self.source.fetch_changed_files_raw(&req.repo, req.number)?;
        let changed_files = normalize_changed_files(&stdout);

        self.cache
            .write_patch(&req.repo, req.number, &req.head_sha, &patch)?;
        self.cache
            .write_changed_files(&req.repo, req.number, &req.head_sha, &changed_files)?;

        Ok(PullRequestDiffBundle {
            repo: req.repo.clone(),
            number: req.number,
            head_sha: req.head_sha.clone(),
            patch,
            changed_files,
        })
    }
}

fn normalize_changed_files(stdout: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for line in stdout.lines() {
        let path = line.trim();
        if !path.is_empty() && seen.insert(path.to_string()) {
            files.push(path.to_string());
        }
    }

    files
}

pub struct GhDiffSource;

impl DiffSource for GhDiffSource {
    fn fetch_patch(&self, repo: &str, number: u32) -> Result<String, String> {
        run_gh(&[
            "pr",
            "diff",
            &number.to_string(),
            "-R",
            repo,
            "--color",
            "never",
        ])
    }

    fn fetch_changed_files_raw(&self, repo: &str, number: u32) -> Result<String, String> {
        run_gh(&[
            "pr",
            "diff",
            &number.to_string(),
            "-R",
            repo,
            "--name-only",
            "--color",
            "never",
        ])
    }
}

pub struct SqliteDiffCache;

impl DiffCache for SqliteDiffCache {
    fn read_patch(
        &self,
        repo: &str,
        number: u32,
        head_sha: &str,
    ) -> Result<Option<String>, String> {
        get_cached_patch(repo, number, head_sha)
    }

    fn write_patch(
        &self,
        repo: &str,
        number: u32,
        head_sha: &str,
        patch: &str,
    ) -> Result<(), String> {
        store_patch(repo, number, head_sha, patch)
    }

    fn read_changed_files(
        &self,
        repo: &str,
        number: u32,
        head_sha: &str,
    ) -> Result<Option<Vec<String>>, String> {
        get_cached_changed_files(repo, number, head_sha)
    }

    fn write_changed_files(
        &self,
        repo: &str,
        number: u32,
        head_sha: &str,
        files: &[String],
    ) -> Result<(), String> {
        store_changed_files(repo, number, head_sha, files)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    use super::*;

    struct MockSource {
        patch_result: Mutex<Result<String, String>>,
        files_result: Mutex<Result<String, String>>,
        fetch_patch_called: AtomicBool,
        fetch_files_called: AtomicBool,
    }

    impl MockSource {
        fn new() -> Self {
            Self {
                patch_result: Mutex::new(Ok(String::new())),
                files_result: Mutex::new(Ok(String::new())),
                fetch_patch_called: AtomicBool::new(false),
                fetch_files_called: AtomicBool::new(false),
            }
        }
    }

    impl DiffSource for MockSource {
        fn fetch_patch(&self, _repo: &str, _number: u32) -> Result<String, String> {
            self.fetch_patch_called.store(true, Ordering::SeqCst);
            self.patch_result.lock().unwrap().clone()
        }

        fn fetch_changed_files_raw(&self, _repo: &str, _number: u32) -> Result<String, String> {
            self.fetch_files_called.store(true, Ordering::SeqCst);
            self.files_result.lock().unwrap().clone()
        }
    }

    struct MockCache {
        patch_data: Mutex<Option<String>>,
        files_data: Mutex<Option<Vec<String>>>,
        read_patch_called: AtomicBool,
        write_patch_called: AtomicBool,
        read_files_called: AtomicBool,
        write_files_called: AtomicBool,
    }

    impl MockCache {
        fn new() -> Self {
            Self {
                patch_data: Mutex::new(None),
                files_data: Mutex::new(None),
                read_patch_called: AtomicBool::new(false),
                write_patch_called: AtomicBool::new(false),
                read_files_called: AtomicBool::new(false),
                write_files_called: AtomicBool::new(false),
            }
        }
    }

    impl DiffCache for MockCache {
        fn read_patch(
            &self,
            _repo: &str,
            _number: u32,
            _head_sha: &str,
        ) -> Result<Option<String>, String> {
            self.read_patch_called.store(true, Ordering::SeqCst);
            Ok(self.patch_data.lock().unwrap().clone())
        }

        fn write_patch(
            &self,
            _repo: &str,
            _number: u32,
            _head_sha: &str,
            _patch: &str,
        ) -> Result<(), String> {
            self.write_patch_called.store(true, Ordering::SeqCst);
            Ok(())
        }

        fn read_changed_files(
            &self,
            _repo: &str,
            _number: u32,
            _head_sha: &str,
        ) -> Result<Option<Vec<String>>, String> {
            self.read_files_called.store(true, Ordering::SeqCst);
            Ok(self.files_data.lock().unwrap().clone())
        }

        fn write_changed_files(
            &self,
            _repo: &str,
            _number: u32,
            _head_sha: &str,
            files: &[String],
        ) -> Result<(), String> {
            self.write_files_called.store(true, Ordering::SeqCst);
            *self.files_data.lock().unwrap() = Some(files.to_vec());
            Ok(())
        }
    }

    #[test]
    fn patch_cache_hit_bypasses_source() {
        let source = MockSource::new();
        let cache = MockCache::new();
        *cache.patch_data.lock().unwrap() = Some("cached patch".to_string());

        let service = DiffDataService::new(&source, &cache);
        let req = DiffDataRequest::new("owner/repo".to_string(), 1, "abc123".to_string()).unwrap();

        let result = service.get_patch(&req).unwrap();

        assert_eq!(result.patch, "cached patch");
        assert!(!source.fetch_patch_called.load(Ordering::SeqCst));
        assert!(cache.read_patch_called.load(Ordering::SeqCst));
        assert!(!cache.write_patch_called.load(Ordering::SeqCst));
    }

    #[test]
    fn patch_cache_miss_fetches_and_writes() {
        let source = MockSource::new();
        *source.patch_result.lock().unwrap() = Ok("fresh patch".to_string());
        let cache = MockCache::new();

        let service = DiffDataService::new(&source, &cache);
        let req = DiffDataRequest::new("owner/repo".to_string(), 1, "abc123".to_string()).unwrap();

        let result = service.get_patch(&req).unwrap();

        assert_eq!(result.patch, "fresh patch");
        assert!(source.fetch_patch_called.load(Ordering::SeqCst));
        assert!(cache.read_patch_called.load(Ordering::SeqCst));
        assert!(cache.write_patch_called.load(Ordering::SeqCst));
    }

    #[test]
    fn changed_files_cache_hit_bypasses_source() {
        let source = MockSource::new();
        let cache = MockCache::new();
        *cache.files_data.lock().unwrap() = Some(vec!["a.rs".to_string(), "b.rs".to_string()]);

        let service = DiffDataService::new(&source, &cache);
        let req = DiffDataRequest::new("owner/repo".to_string(), 1, "abc123".to_string()).unwrap();

        let result = service.get_changed_files(&req).unwrap();

        assert_eq!(result, vec!["a.rs", "b.rs"]);
        assert!(!source.fetch_files_called.load(Ordering::SeqCst));
        assert!(cache.read_files_called.load(Ordering::SeqCst));
        assert!(!cache.write_files_called.load(Ordering::SeqCst));
    }

    #[test]
    fn changed_files_cache_miss_normalizes_and_writes() {
        let source = MockSource::new();
        *source.files_result.lock().unwrap() = Ok("  a.rs  \n\nb.rs\na.rs\n".to_string());
        let cache = MockCache::new();

        let service = DiffDataService::new(&source, &cache);
        let req = DiffDataRequest::new("owner/repo".to_string(), 1, "abc123".to_string()).unwrap();

        let result = service.get_changed_files(&req).unwrap();

        assert_eq!(result, vec!["a.rs", "b.rs"]);
        assert!(source.fetch_files_called.load(Ordering::SeqCst));
        assert!(cache.read_files_called.load(Ordering::SeqCst));
        assert!(cache.write_files_called.load(Ordering::SeqCst));
    }

    #[test]
    fn diff_bundle_cache_hit_bypasses_source() {
        let source = MockSource::new();
        let cache = MockCache::new();
        *cache.patch_data.lock().unwrap() = Some("cached patch".to_string());
        *cache.files_data.lock().unwrap() = Some(vec!["a.rs".to_string(), "b.rs".to_string()]);

        let service = DiffDataService::new(&source, &cache);
        let req = DiffDataRequest::new("owner/repo".to_string(), 1, "abc123".to_string()).unwrap();

        let result = service.get_diff_bundle(&req).unwrap();

        assert_eq!(result.patch, "cached patch");
        assert_eq!(result.changed_files, vec!["a.rs", "b.rs"]);
        assert!(!source.fetch_patch_called.load(Ordering::SeqCst));
        assert!(!source.fetch_files_called.load(Ordering::SeqCst));
    }

    #[test]
    fn diff_bundle_cache_miss_fetches_and_writes_both_resources() {
        let source = MockSource::new();
        *source.patch_result.lock().unwrap() = Ok("fresh patch".to_string());
        *source.files_result.lock().unwrap() = Ok("  a.rs  \n\nb.rs\na.rs\n".to_string());
        let cache = MockCache::new();

        let service = DiffDataService::new(&source, &cache);
        let req = DiffDataRequest::new("owner/repo".to_string(), 1, "abc123".to_string()).unwrap();

        let result = service.get_diff_bundle(&req).unwrap();

        assert_eq!(result.patch, "fresh patch");
        assert_eq!(result.changed_files, vec!["a.rs", "b.rs"]);
        assert!(source.fetch_patch_called.load(Ordering::SeqCst));
        assert!(source.fetch_files_called.load(Ordering::SeqCst));
        assert!(cache.write_patch_called.load(Ordering::SeqCst));
        assert!(cache.write_files_called.load(Ordering::SeqCst));
    }

    #[test]
    fn empty_head_sha_fails() {
        let result = DiffDataRequest::new("owner/repo".to_string(), 1, "   ".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Head SHA"));
    }

    #[test]
    fn empty_repo_fails() {
        let result = DiffDataRequest::new("   ".to_string(), 1, "abc123".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Repo"));
    }

    #[test]
    fn source_error_propagates_without_cache_write() {
        let source = MockSource::new();
        *source.patch_result.lock().unwrap() = Err("gh failed".to_string());
        let cache = MockCache::new();

        let service = DiffDataService::new(&source, &cache);
        let req = DiffDataRequest::new("owner/repo".to_string(), 1, "abc123".to_string()).unwrap();

        let result = service.get_patch(&req);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("gh failed"));
        assert!(!cache.write_patch_called.load(Ordering::SeqCst));
    }
}
