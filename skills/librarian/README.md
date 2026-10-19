# Librarian

Cache remote repositories for reference. Script paths below are relative to this directory.

The goal is to keep a reusable local checkout that is:
- **stable** (predictable path)
- **up to date** (periodic fetch + fast-forward when safe)
- **efficient** (partial clone with `--filter=blob:none`, no repeated full clones)

## Cache location

Repositories are stored at:

`~/.cache/checkouts/<host>/<org>/<repo>`

Example:

`github.com/mitsuhiko/minijinja` → `~/.cache/checkouts/github.com/mitsuhiko/minijinja`

## Bounded JJ-first clone (new destinations)

For a new reference checkout where you want JJ and full history when practical:

```bash
python3 checkout.py https://github.com/mitsuhiko/minijinja /tmp/minijinja-reference
```

Requires Python 3.10+ and Linux/macOS. Pass a Git URL or local repository path,
not `owner/repo` shorthand. The destination must not already exist, even if empty.

The helper:
1. Tries `jj git clone --colocate` in a private temporary directory beside the destination.
2. Monitors total apparent file bytes, including checked-out files, every 0.2 seconds.
3. If the attempt exceeds **100 MB (100,000,000 bytes)**, terminates its process
   group (including Git helpers), removes the failed attempt, and retries with
   `git clone --depth=1 --single-branch --no-tags`. Missing JJ or a failed JJ clone
   also triggers this fallback.
4. Publishes the successful checkout at the destination. Interruptions or failed
   fallback remove the incomplete attempt instead; existing directories are never replaced.

The cap is **best-effort**, not a bandwidth limit or filesystem quota: size scans
can miss transient files and overshoot between samples. The shallow Git fallback
is **not size-capped**; even one revision may contain large files. Symlink targets
outside the checkout are not counted. Submodules are not recursively cloned.

Override the JJ limit or sampling interval if needed:

```bash
python3 checkout.py https://github.com/mitsuhiko/minijinja /tmp/minijinja-reference \
  --max-bytes 100000000 --poll-interval 0.2
```

### Agent-facing result

Progress, child command logs, fallback reasons, and a readable final summary go
to **stderr**. On success, **stdout is a single JSON object**, for example:

```json
{"path":"/tmp/minijinja-reference","backend":"git","history":"shallow","fallback_reason":"size-limit","jj_limit_bytes":100000000,"jj_observed_bytes":100500000,"jj_exit_code":null,"final_bytes":12000000}
```

- `backend` is `jj` or `git`; `history` is `full` or `shallow`.
- `fallback_reason` is `null`, `size-limit`, `jj-failed`, or `jj-unavailable`.
- `jj_observed_bytes` is the largest sampled size, not bytes downloaded or a guaranteed peak.
- `jj_exit_code` is `null` when JJ was unavailable or was still running when the cap triggered.
- Exit status is 0 on success, 1 on clone/filesystem failure, 2 for invalid arguments,
  or 128 + signal number on SIGINT/SIGTERM. Failures emit no success JSON.

**Always tell the user when history is shallow.** Do not assume old commits,
other branches, or tags are available, and do not silently unshallow the fallback.

This is a standalone clone helper, not yet wired into `checkout.sh`. The existing
cache command below still uses its Git clone/refresh policy. In particular, its
branch/upstream refresh logic does not advance detached JJ working copies.
Do not use it to refresh a JJ checkout expecting automatic trunk advancement.

## Command

```bash
bash checkout.sh <repo> --path-only
```

Examples:

```bash
bash checkout.sh mitsuhiko/minijinja --path-only
bash checkout.sh github.com/mitsuhiko/minijinja --path-only
bash checkout.sh https://github.com/mitsuhiko/minijinja --path-only
```

The script will:
1. Parse the repo reference into host/org/repo.
2. Clone if missing.
3. Reuse existing checkout if present.
4. Fetch from `origin` when stale (default interval: 300s).
5. Attempt a fast-forward merge if the checkout is clean and has an upstream.

## Update strategy

- Default behavior is **throttled refresh** (every 5 minutes) to avoid unnecessary network calls.
- Force immediate refresh with:

```bash
bash checkout.sh <repo> --force-update --path-only
```

## Recommended workflow

1. Resolve repository path via `checkout.sh --path-only`.
2. Use that path for searching, reading, and analysis.
3. On later references to the same repo, call `checkout.sh` again; it will find and update the cached checkout.

## If edits are needed

Prefer not to edit directly in the shared cache. Create a separate worktree or copy from the cached checkout for task-specific modifications.

## Notes

- `owner/repo` defaults to `github.com`.
