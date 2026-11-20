"""Builds data/movies.js and data/games.js for ScoreGame.

Score sources, and nothing else:
  IMDb        official ratings file, datasets.imdbws.com (personal, non-commercial use)
  Metacritic  scores recorded on Wikidata; for games missing there, the score
              quoted in the review box of the game's English Wikipedia article
Posters and box art are the lead images of the English Wikipedia articles.

Run from the topbilling folder:  python tools/build_data.py
Downloads are kept in data/cache, so a second run is quick. Delete that folder to refresh.
"""
import gzip
import json
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path("data/cache")
UA = {"User-Agent": "movie-game-prototype/0.1"}
MOVIE_MIN_VOTES = 100_000
GAME_MIN_VOTES = 2_000
FILM_TYPES = "wd:Q11424 wd:Q202866 wd:Q20650540 wd:Q93204 wd:Q29168811"

FILMS_QUERY = """SELECT ?f ?imdb ?title ?score (MIN(YEAR(?date)) AS ?year) WHERE {
  ?s pq:P447 wd:Q150248; ps:P444 ?score. ?f p:P444 ?s; wdt:P345 ?imdb; wdt:P31 ?type.
  VALUES ?type { %s }
  ?article schema:about ?f; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title.
  OPTIONAL { ?f wdt:P577 ?date } } GROUP BY ?f ?imdb ?title ?score""" % FILM_TYPES

GAMES_QUERY = """SELECT ?f ?imdb ?title (MIN(YEAR(?date)) AS ?year) WHERE {
  ?f wdt:P31 wd:Q7889; wdt:P345 ?imdb.
  ?article schema:about ?f; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title.
  OPTIONAL { ?f wdt:P577 ?date } } GROUP BY ?f ?imdb ?title"""

GAMES_MC_QUERY = """SELECT ?f ?score WHERE {
  ?s pq:P447 wd:Q150248; ps:P444 ?score. ?f p:P444 ?s; wdt:P31 wd:Q7889; wdt:P345 ?imdb. }"""


def get(url, tries=6):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as res:
                return res.read()
        except urllib.error.HTTPError as err:
            if err.code not in (429, 503) or attempt == tries - 1:
                raise
            time.sleep(int(err.headers.get("retry-after") or 5 * (attempt + 1)))


def cached(name, fetch):
    path = CACHE / name
    if not path.exists():
        print("fetching", name, flush=True)
        path.write_bytes(fetch())
    return path


def sparql(name, query):
    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(query)
    rows = json.loads(cached(name, lambda: get(url)).read_text(encoding="utf-8"))["results"]["bindings"]
    return [{k: v["value"] for k, v in row.items()} for row in rows]


def wikipedia(params):
    url = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&" + urllib.parse.urlencode(params)
    time.sleep(1.5)
    return json.loads(get(url))


def metacritic_number(text):
    m = re.fullmatch(r"(\d{1,3})(/100)?", text.strip())
    return int(m.group(1)) if m and int(m.group(1)) <= 100 else None


def clean_title(title):
    return re.sub(r"\s\([^()]*(film|video game)\)$", "", title)


def load_imdb():
    path = cached("title.ratings.tsv.gz", lambda: get("https://datasets.imdbws.com/title.ratings.tsv.gz"))
    ratings = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            tconst, rating, votes = line.rstrip("\n").split("\t")
            ratings[tconst] = (float(rating), int(votes))
    return ratings


def asked_titles(data):
    """Wikipedia renames what we ask for (spelling, redirects). Map its title back to ours."""
    asked = {n["to"]: n["from"] for n in data.get("normalized", [])}
    for r in data.get("redirects", []):
        asked[r["to"]] = asked.get(r["from"], r["from"])
    return asked


def lead_images(titles):
    """Wikipedia article title -> upright lead image URL. Results are kept between runs."""
    path = CACHE / "images.json"
    known = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    todo = [t for t in titles if t not in known]
    for i in range(0, len(todo), 50):
        batch = todo[i : i + 50]
        data = wikipedia({
            "action": "query", "prop": "pageimages", "pilicense": "any", "piprop": "thumbnail",
            "pithumbsize": 500, "pilimit": 50, "redirects": 1, "titles": "|".join(batch),
        })["query"]
        asked = asked_titles(data)
        for t in batch:
            known[t] = None
        for page in data.get("pages", []):
            thumb = page.get("thumbnail")
            # Posters and box art are upright. Wide images are stills, logos or photos.
            if thumb and thumb["height"] > thumb["width"] * 1.15:
                known[asked.get(page["title"], page["title"])] = thumb["source"].split("?")[0]
        path.write_text(json.dumps(known), encoding="utf-8")
        print(f"  images {min(i + 50, len(todo))}/{len(todo)}", flush=True)
    return known


def review_box_scores(titles):
    """Wikipedia article title -> Metacritic numbers quoted in its review box."""
    path = CACHE / "game_reviewbox.json"
    known = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    todo = [t for t in titles if t not in known]
    for i in range(0, len(todo), 20):
        batch = todo[i : i + 20]
        for t in batch:
            known[t] = []
        params = {"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                  "redirects": 1, "titles": "|".join(batch)}
        while True:
            reply = wikipedia(params)
            data = reply.get("query", {})
            asked = asked_titles(data)
            for page in data.get("pages", []):
                for rev in page.get("revisions", []):
                    text = rev["slots"]["main"]["content"]
                    field = re.search(r"\|\s*MC\s*=(.*?)(?=\n\s*\||\n\}\})", text, re.S)
                    if field:
                        body = re.sub(r"<ref.*?(/>|</ref>)", "", field.group(1), flags=re.S)
                        nums = [int(n) for n in re.findall(r"\b(\d{1,3})\s*/\s*100", body)]
                        known[asked.get(page["title"], page["title"])] = [n for n in nums if n <= 100]
            if "continue" not in reply:
                break
            params.update(reply["continue"])
        path.write_text(json.dumps(known), encoding="utf-8")
        print(f"  review boxes {min(i + 20, len(todo))}/{len(todo)}", flush=True)
    return known


def entry(imdb_id, title, year, rating, metacritic, image):
    return {"id": imdb_id, "title": clean_title(title), "year": year, "imdb": rating,
            "mc": metacritic, "score": round((rating * 10 + metacritic) / 2, 1), "poster": image}


def write(name, variable, items):
    items.sort(key=lambda m: m["title"])
    Path("data", name).write_text(
        f"window.{variable} = {json.dumps(items, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8")
    print(f"{len(items)} written to data/{name}")


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    imdb = load_imdb()

    films = {}
    for row in sparql("films.json", FILMS_QUERY):
        number = metacritic_number(row["score"])
        rating, votes = imdb.get(row["imdb"], (0, 0))
        if number is None or votes < MOVIE_MIN_VOTES or "year" not in row:
            continue
        film = films.setdefault(row["f"], {"imdb": row["imdb"], "title": row["title"],
                                           "year": int(row["year"]), "rating": rating, "mc": []})
        film["mc"].append(number)

    games = {}
    for row in sparql("games.json", GAMES_QUERY):
        rating, votes = imdb.get(row["imdb"], (0, 0))
        if votes >= GAME_MIN_VOTES and "year" in row:
            games[row["f"]] = {"imdb": row["imdb"], "title": row["title"],
                               "year": int(row["year"]), "rating": rating, "mc": []}
    for row in sparql("games_mc.json", GAMES_MC_QUERY):
        number = metacritic_number(row["score"])
        if number is not None and row["f"] in games:
            games[row["f"]]["mc"].append(number)
    boxes = review_box_scores([g["title"] for g in games.values() if not g["mc"]])
    for game in games.values():
        if not game["mc"]:
            game["mc"] = boxes.get(game["title"], [])
    games = {k: g for k, g in games.items() if g["mc"]}
    print(len(films), "films and", len(games), "games have both scores", flush=True)

    images = lead_images([x["title"] for x in list(films.values()) + list(games.values())])
    for name, variable, group in (("movies.js", "SG_MOVIES", films),
                                  ("games.js", "SG_GAMES", games)):
        # Several Metacritic entries (platforms, re-releases) for one title: take the middle one.
        write(name, variable, [
            entry(x["imdb"], x["title"], x["year"], x["rating"],
                  int(statistics.median_low(x["mc"])), images[x["title"]])
            for x in group.values() if images.get(x["title"])])


if __name__ == "__main__":
    sys.exit(main())
