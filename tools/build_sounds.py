"""Builds data/themes.js: one soundtrack preview clip per well-known video game.

Clips are the 30-second previews Apple publishes through the iTunes Search API.
Apple allows them to be played alongside a link to the track, so every entry keeps
its store link and the page shows it after each round.

Run from the topbilling folder, after build_data.py:  python tools/build_sounds.py
Lookups are kept in data/cache/itunes.json, so a second run is quick.
"""
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path("data/cache")
HOW_MANY = 700          # most-voted games to look up
PAUSE = 3.2             # Apple allows about 20 lookups a minute
FILLER = {"original", "soundtrack", "soundtracks", "game", "video", "videogame", "score", "music",
          "from", "the", "ost", "official", "deluxe", "edition", "complete", "motion", "picture",
          "selections", "and", "of", "a", "an", "definitive", "remastered", "anniversary",
          "collection", "sound", "track", "album", "version", "expanded", "digital", "playstation"}


def words(text):
    text = re.sub(r"\bvol(ume)?\.?\s*\d+\b", " ", text.lower())
    text = text.replace("&", " and ")
    return re.findall(r"[a-z0-9]+", text)


NOT_THE_GAME = re.compile(
    r"motion picture|remix|\bsingle\b|- ep\b|inspired|tribute|cover|piano|radio|karaoke|lullab|8.bit|"
    r"\bfilm\b|\bmovie\b|television|\bseries\b|netflix|hbo|trailer", re.I)


def match_strength(game_title, album):
    """3 when the album is named for exactly this game, 2 when it only starts with it, else 0."""
    if not re.search(r"soundtrack|score|\bost\b|music (from|of)", album, re.I):
        return 0
    if NOT_THE_GAME.search(album):
        return 0
    want = [w for w in words(game_title) if w not in ("the", "a", "an")]
    have = [w for w in words(album) if w not in ("the", "a", "an")]
    if not want or have[: len(want)] != want:
        return 0
    extra = [w for w in have[len(want):] if w not in FILLER]
    return 3 if not extra else 2


def search(term):
    url = "https://itunes.apple.com/search?" + urllib.parse.urlencode(
        {"term": term, "media": "music", "entity": "song", "limit": 50})
    for attempt in range(5):
        try:
            time.sleep(PAUSE)
            with urllib.request.urlopen(url, timeout=60) as res:
                return json.loads(res.read())["results"]
        except urllib.error.HTTPError as err:
            if err.code not in (403, 429, 503):
                raise
            time.sleep(60 * (attempt + 1))
    return None


KEPT = ("trackName", "collectionName", "artistName", "previewUrl", "trackViewUrl",
        "discNumber", "trackNumber")


def best_track(game_title, results):
    best = None
    for r in results:
        if not r.get("previewUrl") or not r.get("collectionName"):
            continue
        strength = match_strength(game_title, r["collectionName"])
        # An album that only starts with the title is usually a sequel ("BioShock 2", "Doom Eternal").
        if strength < 3:
            continue
        name = r.get("trackName", "")
        # The main theme is the tune people know. Failing that, the opening track.
        theme = 0 if re.search(r"\b(main|title) theme\b|\btheme\b|\bmain title", name, re.I) else 1
        rank = (-strength, theme, r.get("discNumber", 1), r.get("trackNumber", 99))
        if best is None or rank < best[0]:
            best = (rank, r)
    if not best:
        return None
    r = best[1]
    return {"track": r["trackName"], "album": r["collectionName"], "artist": r["artistName"],
            "preview": r["previewUrl"], "link": r["trackViewUrl"]}


def main():
    votes = {}
    with gzip.open(CACHE / "title.ratings.tsv.gz", "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            tconst, _, n = line.rstrip("\n").split("\t")
            votes[tconst] = int(n)

    rows = json.loads((CACHE / "games.json").read_text(encoding="utf-8"))["results"]["bindings"]
    games, wiki, years = {}, {}, {}
    for row in rows:
        title = re.sub(r"\s\([^()]*video game\)$", "", row["title"]["value"])
        games[row["imdb"]["value"]] = title
        wiki[row["imdb"]["value"]] = row["title"]["value"]
        if "year" in row:
            years[row["imdb"]["value"]] = int(row["year"]["value"])
    wanted = sorted(games, key=lambda i: -votes.get(i, 0))[:HOW_MANY]

    path = CACHE / "itunes.json"
    known = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for n, imdb_id in enumerate(wanted, 1):
        if imdb_id in known:
            continue
        results = search(games[imdb_id] + " soundtrack")
        if results is None:
            print("Apple is refusing lookups for now. Run again later to carry on.")
            break
        # Keep what Apple sent back, so the matching rules can change without asking again.
        known[imdb_id] = [{k: r[k] for k in KEPT if k in r} for r in results]
        path.write_text(json.dumps(known), encoding="utf-8")
        print(f"  {n}/{len(wanted)} {games[imdb_id]}", flush=True)

    # Each theme carries its own title, year and box art, so the round does not depend on
    # which games made it into the ratings list.
    images = json.loads((CACHE / "images.json").read_text(encoding="utf-8"))
    chosen = {i: best_track(games[i], known[i]) for i in wanted if i in known}
    sounds = [{"id": i, "title": games[i], "year": years[i], "poster": images[wiki[i]], **chosen[i]}
              for i in wanted if chosen.get(i) and images.get(wiki[i]) and i in years]
    Path("data/themes.js").write_text(
        f"window.SG_THEMES = {json.dumps(sounds, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8")
    print(f"{len(sounds)} written to data/themes.js")


if __name__ == "__main__":
    sys.exit(main())
