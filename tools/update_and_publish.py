"""Finishes every lookup, rebuilds the lists and publishes them to the live site.

Safe to run at any time. Lookups already done are skipped, so a run that was cut
short simply carries on where it stopped. Double-click UPDATE.bat to run it.

    python tools/update_and_publish.py            carry on and publish
    python tools/update_and_publish.py --fresh    also refresh the ratings first

Everything it does is written to data/cache/update.log.
"""
import datetime
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG = ROOT / "data" / "cache" / "update.log"
STEPS = ["build_data.py", "build_clips.py", "build_sounds.py", "build_sfx.py"]
# Deleting these makes build_data.py download the ratings and title lists again.
RATINGS = ["title.ratings.tsv.gz", "films.json", "games.json", "games_mc.json"]


def say(text):
    line = f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S}  {text}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def lookup_running():
    """True while another copy of a builder is at work. Two at once get refused by Apple."""
    found = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
         "Where-Object { $_.CommandLine -match 'build_(data|sounds|clips)\\.py' }).Count"],
        capture_output=True, text=True).stdout.strip()
    return found not in ("", "0")


def run(*command):
    with LOG.open("a", encoding="utf-8") as f:
        return subprocess.run(command, cwd=ROOT, stdout=f, stderr=subprocess.STDOUT).returncode


def main():
    LOG.parent.mkdir(parents=True, exist_ok=True)
    while lookup_running():
        say("Waiting for a lookup that is already running.")
        time.sleep(120)

    if "--fresh" in sys.argv:
        for name in RATINGS:
            (LOG.parent / name).unlink(missing_ok=True)
        say("Ratings will be downloaded again.")

    for step in STEPS:
        say(f"Running {step}")
        code = run(sys.executable, "-X", "utf8", f"tools/{step}")
        if code != 0:
            say(f"{step} stopped with an error (see above). Carrying on with what there is.")

    run("git", "add", "-A")
    if run("git", "diff", "--cached", "--quiet") == 0:
        say("Nothing new to publish.")
        return
    run("git", "commit", "-q", "-m", "Refresh movies, games, clips and themes")
    say("Published to the live site." if run("git", "push", "-q") == 0 else "The upload to GitHub failed. Run this again.")


if __name__ == "__main__":
    main()
