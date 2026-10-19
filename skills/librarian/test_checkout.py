"""Offline CLI tests: python3 -m unittest discover -s skills/librarian -v"""

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("checkout.py")


@unittest.skipUnless(os.name == "posix", "requires POSIX process groups")
class CloneTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.destination = self.root / "checkout with spaces"
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}")

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + body)
        path.chmod(0o755)

    def fake_jj(self, body):
        self.executable("jj", "import pathlib, sys\n"
                        "destination = pathlib.Path(sys.argv[-1])\n"
                        "destination.mkdir(parents=True)\n" + body)

    def fake_git(self, fail=False):
        self.executable("git", "import json, pathlib, sys\n"
                        f"pathlib.Path({str(self.root / 'git-args')!r}).write_text(json.dumps(sys.argv[1:]))\n"
                        "destination = pathlib.Path(sys.argv[-1])\n"
                        "destination.mkdir(parents=True)\n"
                        "(destination / 'shallow-data').write_text('shallow')\n"
                        f"sys.exit({7 if fail else 0})\n")

    def command(self, *options):
        return [sys.executable, str(SCRIPT), "https://example.test/org/repo.git",
                str(self.destination), "--poll-interval", "0.01", *options]

    def run_script(self, *options):
        return subprocess.run(self.command(*options), env=self.env, capture_output=True,
                              text=True, timeout=15, check=False)

    def assert_clean(self):
        self.assertEqual(list(self.root.glob(".*.clone-*")), [])

    def test_full_jj_success_and_json_stdout(self):
        self.fake_jj("(destination / 'full-data').write_text('full')\nprint('child stdout')\n")
        self.fake_git()
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["backend"], "jj")
        self.assertEqual(data["history"], "full")
        self.assertIsNone(data["fallback_reason"])
        self.assertEqual(data["jj_limit_bytes"], 100_000_000)
        self.assertIn("child stdout", result.stderr)
        self.assertFalse((self.root / "git-args").exists())
        self.assertEqual((self.destination / "full-data").read_text(), "full")
        self.assert_clean()

    def test_exact_limit_is_accepted(self):
        self.fake_jj("(destination / 'data').write_bytes(b'x' * 1000)\n")
        result = self.run_script("--max-bytes", "1000")
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["backend"], "jj")
        self.assertEqual(data["jj_observed_bytes"], 1000)
        self.assert_clean()

    def test_stubborn_clone_is_killed_after_grace_period(self):
        self.fake_jj("import signal, time\n"
                     "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
                     "(destination / 'data').write_bytes(b'x' * 2000)\n"
                     "time.sleep(30)\n")
        self.fake_git()
        result = self.run_script("--max-bytes", "1000")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["fallback_reason"], "size-limit")
        self.assert_clean()

    def test_fast_oversized_clone_falls_back_after_exit(self):
        self.fake_jj("(destination / 'large-data').write_bytes(b'x' * 2000)\n")
        self.fake_git()
        result = self.run_script("--max-bytes", "1000")
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["fallback_reason"], "size-limit")
        self.assertEqual(data["history"], "shallow")
        self.assertGreater(data["jj_observed_bytes"], 1000)
        self.assertFalse((self.destination / "large-data").exists())
        self.assertTrue((self.destination / "shallow-data").exists())
        args = json.loads((self.root / "git-args").read_text())
        for option in ["--depth=1", "--single-branch", "--no-tags", "--no-local"]:
            self.assertIn(option, args)
        self.assertIn("incomplete", result.stderr)
        self.assert_clean()

    def test_monitor_kills_descendants_that_ignore_term(self):
        marker = self.root / "escaped-child"
        child = ("import pathlib, signal, time; "
                 "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                 "time.sleep(2); "
                 f"pathlib.Path({str(marker)!r}).write_text('escaped')")
        self.fake_jj("import subprocess, time\n"
                     f"subprocess.Popen([sys.executable, '-c', {child!r}])\n"
                     "time.sleep(0.2)\n"
                     "(destination / 'large-data').write_bytes(b'x' * 2000)\n"
                     "time.sleep(30)\n")
        self.fake_git()
        result = self.run_script("--max-bytes", "1000")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["fallback_reason"], "size-limit")
        time.sleep(2.1)
        self.assertFalse(marker.exists(), "a clone helper survived process-group termination")
        self.assert_clean()

    def test_jj_failure_falls_back(self):
        self.fake_jj("sys.exit(12)\n")
        self.fake_git()
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["fallback_reason"], "jj-failed")
        self.assertEqual(data["jj_exit_code"], 12)
        self.assert_clean()

    def test_missing_jj_falls_back(self):
        self.fake_git()
        self.env["PATH"] = str(self.bin)
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["fallback_reason"], "jj-unavailable")
        self.assert_clean()

    def test_both_clones_fail_without_publishing(self):
        self.fake_jj("sys.exit(12)\n")
        self.fake_git(fail=True)
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("shallow Git clone failed (exit 7)", result.stderr)
        self.assertFalse(self.destination.exists())
        self.assert_clean()

    def test_missing_both_tools(self):
        self.env["PATH"] = str(self.bin)
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.destination.exists())
        self.assert_clean()

    def test_existing_destination_is_never_modified(self):
        self.destination.mkdir()
        sentinel = self.destination / "keep"
        sentinel.write_text("existing work")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(sentinel.read_text(), "existing work")
        self.assert_clean()

    def test_existing_empty_directory_is_refused(self):
        self.destination.mkdir()
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertTrue(self.destination.is_dir())
        self.assert_clean()

    def test_dangling_symlink_is_refused(self):
        self.destination.symlink_to(self.root / "missing", target_is_directory=True)
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertTrue(self.destination.is_symlink())
        self.assert_clean()

    def test_symlink_target_is_not_counted(self):
        outside = self.root / "outside"
        outside.write_bytes(b'x' * 2000)
        self.fake_jj(f"(destination / 'link').symlink_to({str(outside)!r})\n")
        result = self.run_script("--max-bytes", "1000")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["backend"], "jj")
        self.assertEqual(outside.stat().st_size, 2000)
        self.assert_clean()

    def test_invalid_limits_do_not_create_destination(self):
        for option, value in [("--max-bytes", "0"), ("--max-bytes", "-1"),
                              ("--poll-interval", "nan"), ("--poll-interval", "inf"),
                              ("--poll-interval", "0")]:
            with self.subTest(option=option, value=value):
                result = self.run_script(option, value)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(self.destination.exists())
        self.assert_clean()

    def test_interrupt_during_fallback_cleans_up(self):
        self.fake_jj("sys.exit(12)\n")
        started = self.root / "git-started"
        self.executable("git", "import pathlib, sys, time\n"
                        "pathlib.Path(sys.argv[-1]).mkdir(parents=True)\n"
                        f"pathlib.Path({str(started)!r}).touch()\n"
                        "time.sleep(30)\n")
        process = subprocess.Popen(self.command(), env=self.env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 5
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(started.exists())
            process.terminate()
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 143, stderr)
            self.assertEqual(stdout, "")
            self.assertFalse(self.destination.exists())
            self.assert_clean()
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_interrupt_cleans_up_without_fallback(self):
        for signum in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signum=signum):
                started = self.root / "started"
                started.unlink(missing_ok=True)
                self.fake_jj(f"import time\npathlib.Path({str(started)!r}).touch()\ntime.sleep(30)\n")
                self.fake_git()
                process = subprocess.Popen(self.command(), env=self.env, stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE, text=True)
                try:
                    deadline = time.monotonic() + 5
                    while not started.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(started.exists())
                    process.send_signal(signum)
                    stdout, stderr = process.communicate(timeout=5)
                    self.assertEqual(process.returncode, 128 + signum, stderr)
                    self.assertEqual(stdout, "")
                    self.assertFalse((self.root / "git-args").exists())
                    self.assertFalse(self.destination.exists())
                    self.assert_clean()
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()


@unittest.skipUnless(os.name == "posix" and shutil.which("jj") and shutil.which("git"),
                     "requires real JJ and Git")
class RealCloneTests(unittest.TestCase):
    def test_local_full_jj_and_shallow_git(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1",
                       GIT_CONFIG_GLOBAL=str(root / "gitconfig"),
                       GIT_AUTHOR_NAME="Test", GIT_AUTHOR_EMAIL="test@example.test",
                       GIT_COMMITTER_NAME="Test", GIT_COMMITTER_EMAIL="test@example.test",
                       JJ_CONFIG=str(root / "jjconfig.toml"))
            (root / "jjconfig.toml").write_text('user.name = "Test"\nuser.email = "test@example.test"\n')

            def git(*args):
                return subprocess.run(["git", "-C", str(source), *args], env=env,
                                      capture_output=True, text=True, check=True).stdout.strip()

            subprocess.run(["git", "init", "-b", "main", str(source)], env=env,
                           capture_output=True, check=True)
            for content in ["first", "second", "third"]:
                (source / "file.txt").write_text(content)
                git("add", ".")
                git("commit", "-m", content)
            git("tag", "test-tag")

            for limit, backend in [(100_000_000, "jj"), (1, "git")]:
                destination = root / backend
                # Use a plain local path: fallback must force a true shallow
                # transport clone instead of Git's default local object copy.
                result = subprocess.run([sys.executable, str(SCRIPT), str(source), str(destination),
                                         "--max-bytes", str(limit)], env=env, capture_output=True,
                                        text=True, timeout=30, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["backend"], backend)
                self.assertEqual((destination / "file.txt").read_text(), "third")
                if backend == "jj":
                    status = subprocess.run(["jj", "-R", str(destination), "status"], env=env,
                                            capture_output=True, text=True, check=False)
                    self.assertEqual(status.returncode, 0, status.stderr)
                    self.assertTrue((destination / ".jj").is_dir())
                    count = subprocess.check_output(
                        ["git", "-C", str(destination), "rev-list", "--count", "HEAD"],
                        env=env, text=True)
                    self.assertEqual(count.strip(), "3")
                else:
                    count = subprocess.check_output(["git", "-C", str(destination), "rev-list",
                                                     "--count", "HEAD"], env=env, text=True)
                    self.assertEqual(count.strip(), "1")
                    self.assertTrue((destination / ".git" / "shallow").exists())
                    self.assertEqual(subprocess.check_output(
                        ["git", "-C", str(destination), "tag"], env=env, text=True), "")
                self.assertEqual(list(root.glob(".*.clone-*")), [])


if __name__ == "__main__":
    unittest.main()
