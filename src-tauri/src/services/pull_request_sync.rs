use std::collections::HashMap;

use crate::github::run_gh;
use crate::models::PullRequestSummary;

#[derive(Debug)]
pub struct PullRequestSyncInput {
    pub repo: String,
}

impl PullRequestSyncInput {
    pub fn new(repo: String) -> Result<Self, String> {
        let repo = repo.trim().to_string();
        if repo.is_empty() {
            return Err("Repo is required".into());
        }
        Ok(Self { repo })
    }
}

#[derive(Debug)]
pub struct PullRequestSyncResult {
    pub pull_requests: Vec<PullRequestSummary>,
}

pub trait PullRequestSource: Send + Sync {
    fn list_open_pull_requests(&self, repo: &str) -> Result<Vec<PullRequestSummary>, String>;
    fn get_pull_request(&self, repo: &str, number: u32) -> Result<PullRequestSummary, String>;
}

pub trait PullRequestStore: Send + Sync {
    fn read_cached_pull_requests(&self, repo: &str) -> Result<Vec<PullRequestSummary>, String>;
    fn write_pull_requests_cache(
        &self,
        repo: &str,
        prs: &[PullRequestSummary],
    ) -> Result<(), String>;
    fn upsert_pull_request_summary(
        &self,
        repo: &str,
        pr: &PullRequestSummary,
    ) -> Result<(), String>;
    fn read_tracked_pull_requests(&self, repo: &str) -> Result<Vec<PullRequestSummary>, String>;
    fn upsert_tracked_pull_request(
        &self,
        repo: &str,
        pr: &PullRequestSummary,
    ) -> Result<(), String>;
    fn update_repo_access_timestamp(&self, repo: &str) -> Result<(), String>;
}

pub struct PullRequestSyncService<S: PullRequestSource, T: PullRequestStore> {
    source: S,
    store: T,
}

impl<S: PullRequestSource, T: PullRequestStore> PullRequestSyncService<S, T> {
    pub fn new(source: S, store: T) -> Self {
        Self { source, store }
    }

    pub fn refresh_repo_pull_requests(
        &self,
        input: PullRequestSyncInput,
    ) -> Result<PullRequestSyncResult, String> {
        let pull_requests = self.source.list_open_pull_requests(&input.repo)?;
        self.store
            .write_pull_requests_cache(&input.repo, &pull_requests)?;
        self.store.update_repo_access_timestamp(&input.repo)?;
        Ok(PullRequestSyncResult { pull_requests })
    }

    pub fn refresh_tracked_pull_requests(
        &self,
        input: PullRequestSyncInput,
    ) -> Result<PullRequestSyncResult, String> {
        let tracked = self.store.read_tracked_pull_requests(&input.repo)?;
        if tracked.is_empty() {
            return Ok(PullRequestSyncResult {
                pull_requests: Vec::new(),
            });
        }

        let open_pull_requests = self.source.list_open_pull_requests(&input.repo)?;
        let open_by_number: HashMap<u32, PullRequestSummary> = open_pull_requests
            .into_iter()
            .map(|pr| (pr.core.number, pr))
            .collect();

        for pull_request in tracked {
            if let Some(open_pr) = open_by_number.get(&pull_request.core.number) {
                self.store
                    .upsert_tracked_pull_request(&input.repo, open_pr)?;
                continue;
            }

            if pull_request.core.state == "OPEN" {
                if let Ok(verified_pr) =
                    self.source.get_pull_request(&input.repo, pull_request.core.number)
                {
                    self.store
                        .upsert_tracked_pull_request(&input.repo, &verified_pr)?;
                }
            }
        }

        self.store.update_repo_access_timestamp(&input.repo)?;
        let pull_requests = self.store.read_tracked_pull_requests(&input.repo)?;
        Ok(PullRequestSyncResult { pull_requests })
    }

    pub fn refresh_pull_request_summary(
        &self,
        input: PullRequestSyncInput,
        number: u32,
    ) -> Result<PullRequestSummary, String> {
        let pull_request = self.source.get_pull_request(&input.repo, number)?;
        self.store
            .upsert_pull_request_summary(&input.repo, &pull_request)?;
        self.store.update_repo_access_timestamp(&input.repo)?;
        Ok(pull_request)
    }
}

fn to_pull_request_summary(
    pull_request: crate::models::GhPullRequest,
) -> PullRequestSummary {
    let merged = pull_request.merged_at.is_some();

    PullRequestSummary {
        core: crate::models::PullRequestCore {
            state: if merged {
                "MERGED".to_string()
            } else {
                pull_request.core.state
            },
            ..pull_request.core
        },
        is_draft: pull_request.is_draft,
        merge_state_status: pull_request
            .merge_state_status
            .unwrap_or_else(|| "UNKNOWN".to_string()),
        mergeable: pull_request
            .mergeable
            .unwrap_or_else(|| "UNKNOWN".to_string()),
        additions: pull_request.additions.unwrap_or(0),
        deletions: pull_request.deletions.unwrap_or(0),
        author_login: pull_request
            .author
            .map(|author| author.login)
            .unwrap_or_else(|| "unknown".into()),
        head_sha: pull_request.head_ref_oid,
        base_sha: pull_request.base_ref_oid,
    }
}

pub struct GhPullRequestSource;

impl PullRequestSource for GhPullRequestSource {
    fn list_open_pull_requests(&self, repo: &str) -> Result<Vec<PullRequestSummary>, String> {
        let stdout = run_gh(&[
            "pr",
            "list",
            "-R",
            repo,
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,state,isDraft,mergeStateStatus,mergeable,additions,deletions,author,updatedAt,url,headRefOid,baseRefOid",
        ])?;

        let pull_requests =
            serde_json::from_str::<Vec<crate::models::GhPullRequest>>(&stdout)
                .map_err(|error| format!("Failed to parse pull requests: {error}"))?;

        Ok(pull_requests
            .into_iter()
            .map(to_pull_request_summary)
            .collect())
    }

    fn get_pull_request(&self, repo: &str, number: u32) -> Result<PullRequestSummary, String> {
        let stdout = run_gh(&[
            "pr",
            "view",
            &number.to_string(),
            "-R",
            repo,
            "--json",
            "number,title,state,isDraft,mergeStateStatus,mergeable,additions,deletions,author,updatedAt,url,headRefOid,baseRefOid,mergedAt",
        ])?;

        let pull_request = serde_json::from_str::<crate::models::GhPullRequest>(&stdout)
            .map_err(|error| format!("Failed to parse pull request #{number}: {error}"))?;

        Ok(to_pull_request_summary(pull_request))
    }
}

pub struct SqlitePullRequestStore;

impl PullRequestStore for SqlitePullRequestStore {
    fn read_cached_pull_requests(&self, repo: &str) -> Result<Vec<PullRequestSummary>, String> {
        crate::cache::read_cached_pull_requests(repo)
    }

    fn write_pull_requests_cache(
        &self,
        repo: &str,
        prs: &[PullRequestSummary],
    ) -> Result<(), String> {
        crate::cache::write_pull_requests_cache(repo, prs)
    }

    fn upsert_pull_request_summary(
        &self,
        repo: &str,
        pr: &PullRequestSummary,
    ) -> Result<(), String> {
        crate::cache::upsert_pull_request_summary(repo, pr)
    }

    fn read_tracked_pull_requests(&self, repo: &str) -> Result<Vec<PullRequestSummary>, String> {
        crate::cache::read_tracked_pull_requests(repo)
    }

    fn upsert_tracked_pull_request(
        &self,
        repo: &str,
        pr: &PullRequestSummary,
    ) -> Result<(), String> {
        crate::cache::track_pull_request(repo, pr)
    }

    fn update_repo_access_timestamp(&self, repo: &str) -> Result<(), String> {
        crate::cache::update_repo_access_timestamp(repo)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;

    struct MockSourceInner {
        list_result: Mutex<Result<Vec<PullRequestSummary>, String>>,
        get_result: Mutex<Result<PullRequestSummary, String>>,
        list_called: AtomicBool,
        get_called: AtomicBool,
    }

    #[derive(Clone)]
    struct MockSource {
        inner: Arc<MockSourceInner>,
    }

    impl MockSource {
        fn new() -> Self {
            Self {
                inner: Arc::new(MockSourceInner {
                    list_result: Mutex::new(Ok(Vec::new())),
                    get_result: Mutex::new(Err("not set".into())),
                    list_called: AtomicBool::new(false),
                    get_called: AtomicBool::new(false),
                }),
            }
        }
    }

    impl PullRequestSource for MockSource {
        fn list_open_pull_requests(
            &self,
            _repo: &str,
        ) -> Result<Vec<PullRequestSummary>, String> {
            self.inner.list_called.store(true, Ordering::SeqCst);
            self.inner.list_result.lock().unwrap().clone()
        }

        fn get_pull_request(
            &self,
            _repo: &str,
            _number: u32,
        ) -> Result<PullRequestSummary, String> {
            self.inner.get_called.store(true, Ordering::SeqCst);
            self.inner.get_result.lock().unwrap().clone()
        }
    }

    struct MockStoreInner {
        cached_prs: Mutex<Option<Vec<PullRequestSummary>>>,
        tracked_prs: Mutex<Vec<PullRequestSummary>>,
        write_cache_called: AtomicBool,
        upsert_summary_called: AtomicBool,
        upsert_called: AtomicBool,
        update_timestamp_called: AtomicBool,
        last_written: Mutex<Vec<PullRequestSummary>>,
        last_summary_upserted: Mutex<Vec<PullRequestSummary>>,
        last_upserted: Mutex<Vec<PullRequestSummary>>,
    }

    #[derive(Clone)]
    struct MockStore {
        inner: Arc<MockStoreInner>,
    }

    impl MockStore {
        fn new() -> Self {
            Self {
                inner: Arc::new(MockStoreInner {
                    cached_prs: Mutex::new(None),
                    tracked_prs: Mutex::new(Vec::new()),
                    write_cache_called: AtomicBool::new(false),
                    upsert_summary_called: AtomicBool::new(false),
                    upsert_called: AtomicBool::new(false),
                    update_timestamp_called: AtomicBool::new(false),
                    last_written: Mutex::new(Vec::new()),
                    last_summary_upserted: Mutex::new(Vec::new()),
                    last_upserted: Mutex::new(Vec::new()),
                }),
            }
        }
    }

    impl PullRequestStore for MockStore {
        fn read_cached_pull_requests(
            &self,
            _repo: &str,
        ) -> Result<Vec<PullRequestSummary>, String> {
            Ok(self.inner.cached_prs.lock().unwrap().clone().unwrap_or_default())
        }

        fn write_pull_requests_cache(
            &self,
            _repo: &str,
            prs: &[PullRequestSummary],
        ) -> Result<(), String> {
            self.inner.write_cache_called.store(true, Ordering::SeqCst);
            *self.inner.last_written.lock().unwrap() = prs.to_vec();
            Ok(())
        }

        fn upsert_pull_request_summary(
            &self,
            _repo: &str,
            pr: &PullRequestSummary,
        ) -> Result<(), String> {
            self.inner
                .upsert_summary_called
                .store(true, Ordering::SeqCst);
            self.inner.last_summary_upserted.lock().unwrap().push(pr.clone());
            Ok(())
        }

        fn read_tracked_pull_requests(
            &self,
            _repo: &str,
        ) -> Result<Vec<PullRequestSummary>, String> {
            Ok(self.inner.tracked_prs.lock().unwrap().clone())
        }

        fn upsert_tracked_pull_request(
            &self,
            _repo: &str,
            pr: &PullRequestSummary,
        ) -> Result<(), String> {
            self.inner.upsert_called.store(true, Ordering::SeqCst);
            self.inner.last_upserted.lock().unwrap().push(pr.clone());
            Ok(())
        }

        fn update_repo_access_timestamp(&self, _repo: &str) -> Result<(), String> {
            self.inner.update_timestamp_called.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    fn make_pr(number: u32, state: &str, title: &str) -> PullRequestSummary {
        PullRequestSummary {
            core: crate::models::PullRequestCore {
                number,
                title: title.into(),
                state: state.into(),
                updated_at: "2025-01-01T00:00:00Z".into(),
                url: format!("https://github.com/owner/repo/pull/{number}"),
            },
            is_draft: false,
            merge_state_status: "CLEAN".into(),
            mergeable: "MERGEABLE".into(),
            additions: 10,
            deletions: 5,
            author_login: "testuser".into(),
            head_sha: "abc123".into(),
            base_sha: Some("def456".into()),
        }
    }

    #[test]
    fn refresh_repo_writes_cache_and_updates_timestamp() {
        let source = MockSource::new();
        let prs = vec![make_pr(1, "OPEN", "feat: foo")];
        *source.inner.list_result.lock().unwrap() = Ok(prs.clone());

        let store = MockStore::new();
        let store_clone = store.clone();
        let service = PullRequestSyncService::new(source, store);
        let input = PullRequestSyncInput::new("owner/repo".into()).unwrap();

        let result = service.refresh_repo_pull_requests(input).unwrap();
        assert_eq!(result.pull_requests.len(), 1);
        assert_eq!(result.pull_requests[0].core.number, 1);
        assert!(store_clone.inner.write_cache_called.load(Ordering::SeqCst));
        assert!(store_clone.inner.update_timestamp_called.load(Ordering::SeqCst));
        assert_eq!(store_clone.inner.last_written.lock().unwrap().len(), 1);
    }

    #[test]
    fn source_error_propagates_without_cache_write() {
        let source = MockSource::new();
        *source.inner.list_result.lock().unwrap() = Err("gh failed".into());

        let store = MockStore::new();
        let store_clone = store.clone();
        let service = PullRequestSyncService::new(source, store);
        let input = PullRequestSyncInput::new("owner/repo".into()).unwrap();

        let result = service.refresh_repo_pull_requests(input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("gh failed"));
        assert!(!store_clone.inner.write_cache_called.load(Ordering::SeqCst));
    }

    #[test]
    fn tracked_refresh_reconciles_open_list() {
        let source = MockSource::new();
        let open_prs = vec![
            make_pr(1, "OPEN", "feat: a"),
            make_pr(2, "OPEN", "feat: b"),
        ];
        *source.inner.list_result.lock().unwrap() = Ok(open_prs.clone());

        let store = MockStore::new();
        *store.inner.tracked_prs.lock().unwrap() = vec![
            make_pr(1, "OPEN", "feat: a old"),
            make_pr(2, "OPEN", "feat: b old"),
        ];

        let store_clone = store.clone();
        let service = PullRequestSyncService::new(source, store);
        let input = PullRequestSyncInput::new("owner/repo".into()).unwrap();

        let result = service.refresh_tracked_pull_requests(input).unwrap();
        assert_eq!(result.pull_requests.len(), 2);
        assert!(store_clone.inner.upsert_called.load(Ordering::SeqCst));
        assert!(store_clone.inner.update_timestamp_called.load(Ordering::SeqCst));

        let upserted = store_clone.inner.last_upserted.lock().unwrap();
        assert_eq!(upserted.len(), 2);
        assert_eq!(upserted[0].core.title, "feat: a");
        assert_eq!(upserted[1].core.title, "feat: b");
    }

    #[test]
    fn tracked_refresh_falls_back_to_single_fetch_for_missing_open() {
        let source = MockSource::new();
        let open_prs = vec![make_pr(1, "OPEN", "feat: a")];
        *source.inner.list_result.lock().unwrap() = Ok(open_prs);
        *source.inner.get_result.lock().unwrap() = Ok(make_pr(2, "OPEN", "feat: b verified"));

        let store = MockStore::new();
        *store.inner.tracked_prs.lock().unwrap() = vec![
            make_pr(1, "OPEN", "feat: a old"),
            make_pr(2, "OPEN", "feat: b old"),
        ];

        let source_clone = source.clone();
        let store_clone = store.clone();
        let service = PullRequestSyncService::new(source, store);
        let input = PullRequestSyncInput::new("owner/repo".into()).unwrap();

        let result = service.refresh_tracked_pull_requests(input).unwrap();
        assert_eq!(result.pull_requests.len(), 2);
        assert!(source_clone.inner.get_called.load(Ordering::SeqCst));

        let upserted = store_clone.inner.last_upserted.lock().unwrap();
        assert_eq!(upserted.len(), 2);
        assert_eq!(upserted[0].core.title, "feat: a");
        assert_eq!(upserted[1].core.title, "feat: b verified");
    }

    #[test]
    fn empty_repo_fails() {
        let result = PullRequestSyncInput::new("   ".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Repo"));
    }

    #[test]
    fn empty_tracked_list_returns_empty_without_source_call() {
        let source = MockSource::new();
        let source_clone = source.clone();
        let store = MockStore::new();

        let service = PullRequestSyncService::new(source, store);
        let input = PullRequestSyncInput::new("owner/repo".into()).unwrap();

        let result = service.refresh_tracked_pull_requests(input).unwrap();
        assert!(result.pull_requests.is_empty());
        assert!(!source_clone.inner.list_called.load(Ordering::SeqCst));
    }

    #[test]
    fn summary_refresh_fetches_single_pr_and_updates_cache() {
        let source = MockSource::new();
        *source.inner.get_result.lock().unwrap() = Ok(make_pr(7, "OPEN", "feat: selected"));

        let store = MockStore::new();
        let store_clone = store.clone();
        let service = PullRequestSyncService::new(source, store);
        let input = PullRequestSyncInput::new("owner/repo".into()).unwrap();

        let result = service.refresh_pull_request_summary(input, 7).unwrap();
        assert_eq!(result.core.number, 7);
        assert!(store_clone.inner.upsert_summary_called.load(Ordering::SeqCst));
        assert!(store_clone.inner.update_timestamp_called.load(Ordering::SeqCst));

        let upserted = store_clone.inner.last_summary_upserted.lock().unwrap();
        assert_eq!(upserted.len(), 1);
        assert_eq!(upserted[0].core.title, "feat: selected");
    }
}
