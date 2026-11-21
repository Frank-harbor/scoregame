"""Builds data/clips.js: an official trailer for each well-known movie and game.

Movies  the trailer Apple serves as the iTunes Store preview, found through the
        iTunes movie ID recorded on Wikidata.
Games   the trailer on the game's Steam store page, found through the Steam ID
        recorded on Wikidata.

The page plays a few seconds from the middle of each trailer. Nothing is copied:
every clip streams from Apple or Steam, with a link back to the store page.

Run from the topbilling folder, after build_data.py:  python tools/build_clips.py
Lookups are kept in data/cache, so a second run is quick.
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path("data/cache")
MOVIE_MIN_VOTES = 4_000
GAME_MIN_VOTES = 100
UA = {"User-Agent": "movie-game-prototype/0.1"}


def get_json(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as err:
            if err.code not in (403, 429, 503):
                return None
            time.sleep(60 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, ValueError):
            time.sleep(10)
    return None


def titles(name, variable):
    text = Path("data", name).read_text(encoding="utf-8")
    return json.loads(text[len(f"window.{variable} = "):].rstrip().rstrip(";"))


# Wikidata lists which store each title is sold in: P6398 is the iTunes movie ID, P1733 the Steam ID.
ID_QUERIES = {
    "itunes_movie_ids.json": "SELECT ?imdb ?itunes WHERE { ?f wdt:P6398 ?itunes; wdt:P345 ?imdb. }",
    "steam_ids.json": "SELECT ?imdb ?steam WHERE { ?f wdt:P31 wd:Q7889; wdt:P1733 ?steam; wdt:P345 ?imdb. }",
}


def id_map(name, key):
    path = CACHE / name
    if not path.exists():
        print("fetching", name, flush=True)
        url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(ID_QUERIES[name])
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as res:
            path.write_bytes(res.read())
    rows = json.loads(path.read_text(encoding="utf-8"))["results"]["bindings"]
    return {row["imdb"]["value"]: row[key]["value"] for row in rows}


def cache(name):
    path = CACHE / name
    return path, (json.loads(path.read_text(encoding="utf-8")) if path.exists() else {})


def movie_trailers(movies):
    # Wikidata holds a few Apple TV codes in this field. One of those makes Apple reject
    # the whole batch, so only plain store numbers go into a lookup.
    apple = {imdb: store for imdb, store in id_map("itunes_movie_ids.json", "itunes").items() if store.isdigit()}
    path, known = cache("movie_trailers.json")
    todo = [apple[m["id"]] for m in movies if m["id"] in apple and apple[m["id"]] not in known]
    for i in range(0, len(todo), 150):  # one request answers for 150 movies
        batch = todo[i : i + 150]
        reply = get_json("https://itunes.apple.com/lookup?country=us&id=" + ",".join(batch))
        if reply is None:
            print("Apple did not answer this batch. Run again later to carry on.")
            break
        for apple_id in batch:
            known[apple_id] = None
        for r in reply.get("results", []):
            if r.get("previewUrl"):
                known[str(r["trackId"])] = {"preview": r["previewUrl"], "link": r.get("trackViewUrl", "")}
        path.write_text(json.dumps(known), encoding="utf-8")
        print(f"  movie trailers {min(i + 150, len(todo))}/{len(todo)}", flush=True)
        time.sleep(3.2)
    return [{"id": m["id"], "kind": "movie", "title": m["title"], "year": m["year"], "poster": m["poster"],
             "votes": m["votes"], **known[apple[m["id"]]]}
            for m in movies if m["id"] in apple and known.get(apple[m["id"]])]


def game_trailers(games):
    steam = id_map("steam_ids.json", "steam")
    path, known = cache("game_trailers.json")
    todo = [g for g in games if g["id"] in steam and steam[g["id"]] not in known]
    for n, game in enumerate(todo, 1):
        app = steam[game["id"]]
        reply = get_json(f"https://store.steampowered.com/api/appdetails?appids={app}&filters=movies")
        if reply is None:
            print("Steam is refusing lookups for now. Run again later to carry on.")
            break
        films = ((reply.get(app) or {}).get("data") or {}).get("movies") or []
        # The page's main trailer is the one flagged as a highlight.
        films.sort(key=lambda f: not f.get("highlight"))
        stream = next((f["hls_h264"] for f in films if f.get("hls_h264")), None)
        known[app] = stream
        path.write_text(json.dumps(known), encoding="utf-8")
        print(f"  game trailers {n}/{len(todo)} {game['title']}", flush=True)
        time.sleep(1.6)  # Steam allows about 200 lookups every 5 minutes
    return [{"id": g["id"], "kind": "game", "title": g["title"], "year": g["year"], "poster": g["poster"],
             "votes": g["votes"], "hls": known[steam[g["id"]]], "link": f"https://store.steampowered.com/app/{steam[g['id']]}"}
            for g in games if g["id"] in steam and known.get(steam[g["id"]])]


def main():
    movies = sorted((m for m in titles("movies.js", "SG_MOVIES") if m["votes"] >= MOVIE_MIN_VOTES),
                    key=lambda m: -m["votes"])
    games = sorted((g for g in titles("games.js", "SG_GAMES") if g["votes"] >= GAME_MIN_VOTES),
                   key=lambda g: -g["votes"])
    clips = movie_trailers(movies) + game_trailers(games)
    Path("data/clips.js").write_text(
        f"window.SG_CLIPS = {json.dumps(clips, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8")
    counts = {k: sum(1 for c in clips if c["kind"] == k) for k in ("movie", "game")}
    print(f"{counts['movie']} movie clips and {counts['game']} game clips written to data/clips.js")


if __name__ == "__main__":
    sys.exit(main())
