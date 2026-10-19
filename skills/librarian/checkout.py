#!/usr/bin/env python3
"""Try a size-bounded full JJ clone, falling back to shallow Git (POSIX)."""

import argparse
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MAX_BYTES = 100_000_000  # Decimal MB, not MiB.
DEFAULT_POLL_INTERVAL = 0.2


def report(message):
    print(f"librarian: {message}", file=sys.stderr, flush=True)


def directory_bytes(path):
    """Sum apparent file sizes without following symlinks outside the clone."""
    total = 0
    for root, _, files in os.walk(path, onerror=raise_walk_error):
        for name in files:
            try:
                total += (Path(root) / name).lstat().st_size
            except FileNotFoundError:
                # Git can rename/remove temporary packs while we walk.
                pass
    return total


def raise_walk_error(error):
    if not isinstance(error, FileNotFoundError):
        raise error


def stop_process_group(process):
    """Stop helpers too, including ones that ignore TERM after their parent exits."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait()
        return
    try:
        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


@dataclass
class Attempt:
    exit_code: int | None
    observed_bytes: int
    exceeded_limit: bool


def run_clone(command, destination, max_bytes=None, poll_interval=DEFAULT_POLL_INTERVAL):
    # The clone runs concurrently with this watchdog. Redirect even child stdout
    # to stderr so stdout remains a single machine-readable result.
    process = subprocess.Popen(command, start_new_session=True, stdout=sys.stderr)
    observed = 0
    try:
        while True:
            observed = max(observed, directory_bytes(destination))
            code = process.poll()
            if code is not None:
                # Catch a fast clone that finishes between watchdog samples.
                observed = max(observed, directory_bytes(destination))
            exceeded = max_bytes is not None and observed > max_bytes
            if exceeded or code is not None:
                return Attempt(code, observed, exceeded)
            try:
                process.wait(timeout=poll_interval)
            except subprocess.TimeoutExpired:
                pass
    finally:
        # Runs on size abort, clone error, Ctrl-C, SIGTERM, and monitor errors.
        # Reap/kill before TemporaryDirectory removes the unfinished checkout.
        stop_process_group(process)


def clone_repository(source, destination, max_bytes=DEFAULT_MAX_BYTES,
                     poll_interval=DEFAULT_POLL_INTERVAL):
    destination = Path(destination).expanduser().absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Reserve atomically: never reuse/delete an existing destination, even an
    # empty directory or a dangling symlink. Competing invocations fail safely.
    destination.mkdir()
    published = False
    try:
        with tempfile.TemporaryDirectory(
            prefix=f".{destination.name}.clone-", dir=destination.parent
        ) as temporary:
            checkout = Path(temporary) / "repo"
            report(f"Trying full JJ history; best-effort limit {max_bytes:,} bytes "
                   f"({max_bytes / 1_000_000:g} MB), including checked-out files.")
            jj_attempt = None
            reason = None
            try:
                jj_attempt = run_clone(
                    ["jj", "git", "clone", "--colocate", "--", source, str(checkout)],
                    checkout, max_bytes, poll_interval,
                )
            except FileNotFoundError as error:
                if error.filename != "jj":
                    raise
                reason = "jj-unavailable"

            if jj_attempt is not None:
                if jj_attempt.exceeded_limit:
                    reason = "size-limit"
                elif jj_attempt.exit_code != 0:
                    reason = "jj-failed"

            if reason is None:
                backend, history = "jj", "full"
            else:
                detail = {
                    "size-limit": f"JJ clone exceeded the limit ({jj_attempt.observed_bytes:,} bytes observed)."
                    if jj_attempt else "",
                    "jj-failed": f"JJ clone failed (exit {jj_attempt.exit_code})."
                    if jj_attempt else "",
                    "jj-unavailable": "JJ is not installed.",
                }[reason]
                report(f"{detail} Falling back to Git: depth 1, single branch, no tags. "
                       "History will be incomplete; the fallback has no size cap.")
                # Remove only the private attempt, never an existing checkout.
                if checkout.exists():
                    shutil.rmtree(checkout)
                git_attempt = run_clone(
                    ["git", "clone", "--no-local", "--depth=1", "--single-branch", "--no-tags",
                     "--", source, str(checkout)],
                    checkout, poll_interval=poll_interval,
                )
                if git_attempt.exit_code != 0:
                    raise RuntimeError(f"shallow Git clone failed (exit {git_attempt.exit_code})")
                backend, history = "git", "shallow"

            final_bytes = directory_bytes(checkout)
            checkout.rename(destination)  # Replace only our own empty reservation.
            published = True
            report(f"Ready: {backend}, {history} history, {final_bytes / 1_000_000:.1f} MB "
                   f"at {destination}.")
            return {
                "path": str(destination),
                "backend": backend,
                "history": history,
                "fallback_reason": reason,
                "jj_limit_bytes": max_bytes,
                "jj_observed_bytes": jj_attempt.observed_bytes if jj_attempt else None,
                "jj_exit_code": jj_attempt.exit_code if jj_attempt else None,
                "final_bytes": final_bytes,
            }
    finally:
        if not published:
            destination.rmdir()  # Never recursively delete a destination.


class Interrupted(Exception):
    def __init__(self, signum):
        self.signum = signum


def interrupt(signum, _frame):
    raise Interrupted(signum)


def positive_bytes(value):
    number = int(value)
    if number <= 0:
        raise ValueError("must be positive")
    return number


def positive_seconds(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise ValueError("must be finite and positive")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Git repository URL or local path (not owner/repo shorthand)")
    parser.add_argument("destination", help="new checkout directory; must not already exist")
    parser.add_argument("--max-bytes", type=positive_bytes, default=DEFAULT_MAX_BYTES,
                        help="best-effort JJ file-size limit (default: 100000000 = 100 MB)")
    parser.add_argument("--poll-interval", type=positive_seconds, default=DEFAULT_POLL_INTERVAL,
                        help="seconds between size samples (default: 0.2)")
    args = parser.parse_args()
    if os.name != "posix":
        parser.error("requires POSIX process groups (Linux/macOS)")
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, interrupt)
    try:
        result = clone_repository(args.source, args.destination, args.max_bytes, args.poll_interval)
    except Interrupted as error:
        report("Interrupted; stopped clone processes and removed the incomplete attempt.")
        return 128 + error.signum
    except (OSError, RuntimeError) as error:
        report(f"error: {error}")
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
