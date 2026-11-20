"""Builds data/themes.js: one soundtrack clip per well-known video game and movie.

Clips are the 30-second previews Apple publishes through the iTunes Search API.
Apple allows them to be played alongside a link to the track, so every entry keeps
its store link and the page shows it after each round.

Each clip is also measured with ffmpeg so the game starts it at its loudest stretch,
the part people recognise, and never on a silent lead-in.

Run from the topbilling folder, after build_data.py:  python tools/build_sounds.py
Lookups and measurements are kept in data/cache, so a second run is quick.
"""
import array
import gzip
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from build_data import lead_images

CACHE = Path("data/cache")
GAMES_TO_TRY = 2500     # most-voted games to look up
MOVIES_TO_TRY = 1200    # most-voted movies to look up
PAUSE = 3.2             # Apple allows about 20 lookups a minute
LONGEST_CLIP = 10       # seconds the game may play before the answer
FILLER = {"original", "soundtrack", "soundtracks", "game", "video", "videogame", "score", "music",
          "from", "the", "ost", "official", "deluxe", "edition", "complete", "motion", "picture",
          "selections", "and", "of", "a", "an", "definitive", "remastered", "anniversary",
          "collection", "sound", "track", "album", "version", "expanded", "digital", "playstation",
          "film", "movie", "extended", "special", "bonus"}
NEVER = r"remix|\bsingle\b|- ep\b|inspired|tribute|cover|piano|radio|karaoke|lullab|8.bit|trailer|songs from"
WRONG_ALBUM = {
    "game": re.compile(NEVER + r"|motion picture|\bfilm\b|\bmovie\b|television|\bseries\b|netflix|hbo", re.I),
    "movie": re.compile(NEVER + r"|\bgame\b|videogame|television|\bseries\b|\bseason\b|musical|broadway|cast recording", re.I),
}
KEPT = ("trackName", "collectionName", "artistName", "previewUrl", "trackViewUrl",
        "discNumber", "trackNumber")


def words(text):
    text = re.sub(r"\bvol(ume)?\.?\s*\d+\b", " ", text.lower())
    text = text.replace("&", " and ")
    return re.findall(r"[a-z0-9]+", text)


def named_for(title, album, kind):
    """True when the album is the soundtrack of exactly this title, not a sequel or a spin-off."""
    if not re.search(r"soundtrack|score|\bost\b|music (from|of)", album, re.I):
        return False
    if WRONG_ALBUM[kind].search(album):
        return False
    want = [w for w in words(title) if w not in ("the", "a", "an")]
    have = [w for w in words(album) if w not in ("the", "a", "an")]
    if not want or have[: len(want)] != want:
        return False
    # Anything left over that is not soundtrack wording means another title ("BioShock 2", "Doom Eternal").
    return all(w in FILLER for w in have[len(want):])


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
        except (urllib.error.URLError, TimeoutError):
            time.sleep(20)
    return None


def plain(track_name):
    """A track name boiled down for comparing across music services."""
    return " ".join(words(re.sub(r"[(\[].*?[)\]]", " ", track_name)))


def popular_tracks(title, kind, known, offline):
    """Track names from this title's soundtrack, most played first, according to Deezer."""
    key = f"{kind}:{title}"
    if key not in known:
        if offline:
            return []
        url = "https://api.deezer.com/search?" + urllib.parse.urlencode({"q": title + " soundtrack", "limit": 50})
        try:
            time.sleep(0.15)  # Deezer allows 50 lookups every 5 seconds
            with urllib.request.urlopen(url, timeout=30) as res:
                rows = json.loads(res.read()).get("data") or []
        except (urllib.error.URLError, TimeoutError, ValueError):
            return []
        known[key] = [[r["rank"], r["title"], r["album"]["title"]] for r in rows]
    rows = [r for r in known[key] if named_for(title, r[2], kind)]
    return [plain(r[1]) for r in sorted(rows, key=lambda r: -r[0])]


def best_track(title, results, kind, popular=()):
    on_album = [r for r in results if r.get("previewUrl") and r.get("collectionName")
                and named_for(title, r["collectionName"], kind)]
    # The most played track is the one people know, so it wins when both services carry it.
    for name in popular:
        for r in on_album:
            if name and plain(r.get("trackName", "")) == name:
                return {"track": r["trackName"], "album": r["collectionName"], "artist": r["artistName"],
                        "preview": r["previewUrl"], "link": r["trackViewUrl"]}
    best = None
    for r in on_album:
        name = r.get("trackName", "")
        # The main theme is the tune people know. Next best is a track named after the title,
        # then the opening track.
        if re.search(r"\b(main|title) theme\b|\bmain titles?\b|\btheme\b", name, re.I):
            tune = 0
        elif words(name)[: len(words(title))] == words(title):
            tune = 1
        else:
            tune = 2
        rank = (tune, r.get("discNumber", 1), r.get("trackNumber", 99))
        if best is None or rank < best[0]:
            best = (rank, r)
    if not best:
        return None
    r = best[1]
    return {"track": r["trackName"], "album": r["collectionName"], "artist": r["artistName"],
            "preview": r["previewUrl"], "link": r["trackViewUrl"]}


def loud_start(url):
    """Seconds into the clip where its loudest 10-second stretch begins, or None if unreadable."""
    try:
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", url, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
            capture_output=True, timeout=90).stdout
    except (subprocess.TimeoutExpired, OSError):
        return None
    samples = array.array("h")
    samples.frombytes(raw[: len(raw) // 2 * 2])
    step = 800  # a tenth of a second
    energy = [sum(s * s for s in samples[i : i + step]) / step for i in range(0, len(samples) - step, step)]
    span = LONGEST_CLIP * 10
    if len(energy) < span + 5:
        return None
    total = sum(energy[:span])
    best_total, best_at = total, 0
    for i in range(1, len(energy) - span):
        total += energy[i + span - 1] - energy[i - 1]
        if total > best_total:
            best_total, best_at = total, i
    # Step forward to the first moment that is properly audible, so even half a second gives a sound.
    floor = (best_total / span) * 0.25
    at = best_at
    while at < len(energy) - span and energy[at] < floor:
        at += 1
    return round(at / 10, 1)


def load_titles(name, kind_suffix):
    rows = json.loads((CACHE / name).read_text(encoding="utf-8"))["results"]["bindings"]
    out = {}
    for row in rows:
        imdb_id = row["imdb"]["value"]
        if "year" not in row:
            continue
        wiki = row["title"]["value"]
        out[imdb_id] = {"wiki": wiki, "title": re.sub(r"\s\([^()]*%s\)$" % kind_suffix, "", wiki),
                        "year": int(row["year"]["value"])}
    return out


def main():
    votes = {}
    with gzip.open(CACHE / "title.ratings.tsv.gz", "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            tconst, _, n = line.rstrip("\n").split("\t")
            votes[tconst] = int(n)

    pools = {"game": load_titles("games.json", "video game"), "movie": load_titles("films.json", "film")}
    wanted = []
    for kind, how_many in (("game", GAMES_TO_TRY), ("movie", MOVIES_TO_TRY)):
        ids = sorted(pools[kind], key=lambda i: -votes.get(i, 0))[:how_many]
        wanted += [(kind, i) for i in ids]
    # Games and movies take turns, so both lists grow even if the run is cut short.
    wanted.sort(key=lambda pair: -votes.get(pair[1], 0) * (60 if pair[0] == "game" else 1))

    path = CACHE / "itunes.json"
    known = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for n, (kind, imdb_id) in enumerate(wanted, 1):
        if "--offline" in sys.argv:
            break
        if imdb_id in known:
            continue
        results = search(pools[kind][imdb_id]["title"] + " soundtrack")
        if results is None:
            print("Apple is refusing lookups for now. Run again later to carry on.")
            break
        # Keep what Apple sent back, so the matching rules can change without asking again.
        known[imdb_id] = [{k: r[k] for k in KEPT if k in r} for r in results]
        path.write_text(json.dumps(known), encoding="utf-8")
        print(f"  {n}/{len(wanted)} {pools[kind][imdb_id]['title']}", flush=True)

    plays_path = CACHE / "deezer.json"
    plays = json.loads(plays_path.read_text(encoding="utf-8")) if plays_path.exists() else {}
    chosen = []
    for kind, imdb_id in wanted:
        title = pools[kind][imdb_id]["title"]
        if imdb_id not in known or not best_track(title, known[imdb_id], kind):
            continue
        popular = popular_tracks(title, kind, plays, "--no-deezer" in sys.argv)
        chosen.append((kind, imdb_id, best_track(title, known[imdb_id], kind, popular)))
    plays_path.write_text(json.dumps(plays), encoding="utf-8")

    starts_path = CACHE / "starts.json"
    starts = json.loads(starts_path.read_text(encoding="utf-8")) if starts_path.exists() else {}
    for n, (_, _, track) in enumerate(chosen, 1):
        if track["preview"] not in starts:
            starts[track["preview"]] = loud_start(track["preview"])
            starts_path.write_text(json.dumps(starts), encoding="utf-8")
            print(f"  measured {n}/{len(chosen)}", flush=True)

    images = lead_images([pools[kind][i]["wiki"] for kind, i, _ in chosen])
    themes = []
    for kind, imdb_id, track in chosen:
        info = pools[kind][imdb_id]
        start = starts.get(track["preview"])
        if images.get(info["wiki"]) and start is not None:
            themes.append({"id": imdb_id, "kind": kind, "title": info["title"], "year": info["year"],
                           "poster": images[info["wiki"]], "start": start, **track})
    Path("data/themes.js").write_text(
        f"window.SG_THEMES = {json.dumps(themes, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8")
    counts = {k: sum(1 for t in themes if t["kind"] == k) for k in ("game", "movie")}
    print(f"{counts['game']} game themes and {counts['movie']} movie themes written to data/themes.js")


if __name__ == "__main__":
    sys.exit(main())
