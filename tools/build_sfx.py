"""Builds data/sounds.js from the audio files in the sounds folder.

Put clips you have the right to use in topbilling/sounds, named

    Game Title - what the sound is.mp3      (also .ogg, .m4a, .wav)

for example "Halo - shield recharge.mp3". The game title has to match the game's
English Wikipedia name. Then run, from the topbilling folder:

    python tools/build_sfx.py

Once eight or more clips match, a Sound effects option appears beside the themes
and in 1v1. Files that match no game are listed so the name can be fixed.
"""
import json
import re
import sys
from pathlib import Path

CACHE = Path("data/cache")
SOUNDS = Path("sounds")


def main():
    rows = json.loads((CACHE / "games.json").read_text(encoding="utf-8"))["results"]["bindings"]
    images = json.loads((CACHE / "images.json").read_text(encoding="utf-8"))
    games = {}
    for row in rows:
        wiki = row["title"]["value"]
        title = re.sub(r"\s\([^()]*video game\)$", "", wiki)
        if "year" in row and images.get(wiki):
            games[title.lower()] = {"id": row["imdb"]["value"], "title": title,
                                    "year": int(row["year"]["value"]), "poster": images[wiki]}

    sounds, unmatched = [], []
    files = sorted(SOUNDS.glob("*")) if SOUNDS.exists() else []
    for path in files:
        if path.suffix.lower() not in (".mp3", ".ogg", ".m4a", ".wav"):
            continue
        name, _, what = path.stem.partition(" - ")
        game = games.get(name.strip().lower())
        if not game:
            unmatched.append(path.name)
            continue
        # One clip per game: the round asks which game a sound is from.
        if any(s["id"] == game["id"] for s in sounds):
            continue
        sounds.append({**game, "track": what.strip() or "Sound effect", "preview": f"sounds/{path.name}", "start": 0})

    Path("data/sounds.js").write_text(
        f"window.SG_SOUNDS = {json.dumps(sounds, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8")
    print(f"{len(sounds)} sound clips written to data/sounds.js")
    for name in unmatched:
        print("  no game found for:", name)


if __name__ == "__main__":
    sys.exit(main())
