"""Fail CI if private runtime artifacts or obvious credential files are tracked."""
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
bad = []
for name in filter(None, paths):
    p = pathlib.PurePosixPath(name)
    if (p.suffix.lower() == ".pdf" or p.parts[0] in {"private", "data", "artifacts", "traces", "eval-results"}
        or (p.name.startswith(".env") and p.name != ".env.example")
        or "credentials" in p.name.lower() or "service-account" in p.name.lower()):
        bad.append(name)
if bad:
    raise SystemExit("Private artifact paths must not be tracked: " + ", ".join(bad))
print("Tracked-path privacy check passed (manual content review is still required).")
