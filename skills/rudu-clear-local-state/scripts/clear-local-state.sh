#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: clear-local-state.sh [--dry-run]

Clears local Rudu development state for onboarding checks:
  - ~/Library/Application Support/com.tanvesh.rudu/cache.sqlite tables
  - WebKit localStorage key rudu-onboarding-complete

Options:
  --dry-run   Print target paths and counts without deleting anything.
  -h, --help  Show this help text.
USAGE
}

dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      dry_run=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required but was not found on PATH." >&2
  exit 1
fi

app_identifier="${RUDU_APP_IDENTIFIER:-com.tanvesh.rudu}"
app_data_dir="${HOME}/Library/Application Support/${app_identifier}"
cache_db_path="${app_data_dir}/cache.sqlite"
onboarding_key="rudu-onboarding-complete"

tables=(
  active_review_chat_turns
  review_chat_timeline_events
  review_chat_messages
  tracked_pull_requests
  repo_pull_requests
  pr_changed_files_cache
  pr_patch_cache
  review_sessions
  repos
)

print_process_hint() {
  if pgrep -fl 'target/debug/rudu|tauri dev|node .*/vite' >/dev/null 2>&1; then
    echo "Note: Rudu/dev processes appear to be running. Restart or reload the Tauri window after clearing."
  fi
}

print_db_counts() {
  local db_path="$1"
  if [[ ! -f "$db_path" ]]; then
    echo "Cache DB not found: $db_path"
    return
  fi

  echo "Cache DB: $db_path"
  for table in "${tables[@]}"; do
    local count
    count="$(sqlite3 "$db_path" "SELECT COUNT(*) FROM ${table};" 2>/dev/null || echo "missing")"
    printf '  %-32s %s\n' "$table" "$count"
  done
}

clear_cache_db() {
  local db_path="$1"
  [[ -f "$db_path" ]] || return

  sqlite3 "$db_path" <<SQL
.timeout 5000
BEGIN IMMEDIATE;
DELETE FROM active_review_chat_turns;
DELETE FROM review_chat_timeline_events;
DELETE FROM review_chat_messages;
DELETE FROM tracked_pull_requests;
DELETE FROM repo_pull_requests;
DELETE FROM pr_changed_files_cache;
DELETE FROM pr_patch_cache;
DELETE FROM review_sessions;
DELETE FROM repos;
COMMIT;
VACUUM;
SQL
}

localstorage_dbs() {
  find \
    "${HOME}/Library/WebKit/${app_identifier}" \
    "${HOME}/Library/WebKit/rudu" \
    -path '*/LocalStorage/localstorage.sqlite3' \
    -type f \
    -print 2>/dev/null || true
}

print_onboarding_key_counts() {
  local found=0
  while IFS= read -r db_path; do
    [[ -n "$db_path" ]] || continue
    found=1
    local count
    count="$(sqlite3 "$db_path" "SELECT COUNT(*) FROM ItemTable WHERE key = '${onboarding_key}';" 2>/dev/null || echo "unreadable")"
    printf 'LocalStorage: %s\n  %s=%s\n' "$db_path" "$onboarding_key" "$count"
  done < <(localstorage_dbs)

  if [[ "$found" -eq 0 ]]; then
    echo "No WebKit localStorage databases found for ${app_identifier} or rudu."
  fi
}

clear_onboarding_key() {
  while IFS= read -r db_path; do
    [[ -n "$db_path" ]] || continue
    sqlite3 "$db_path" ".timeout 5000" "DELETE FROM ItemTable WHERE key = '${onboarding_key}';" 2>/dev/null || true
  done < <(localstorage_dbs)
}

print_process_hint

echo "Before:"
print_db_counts "$cache_db_path"
print_onboarding_key_counts

if [[ "$dry_run" -eq 1 ]]; then
  echo "Dry run only; no state was changed."
  exit 0
fi

clear_cache_db "$cache_db_path"
clear_onboarding_key

echo
echo "After:"
print_db_counts "$cache_db_path"
print_onboarding_key_counts

echo "Done. Restart or reload the Tauri window to see onboarding with fresh in-memory state."
