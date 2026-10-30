"""Fetch retirement causes from the Wikipedia race reports (plan step B5).

Jolpica (B1) gives almost every retirement as just "Retired", and OpenF1 has no
cause at all. The race-classification table of each Wikipedia race report lists
one for every car that didn't finish ("Power unit", "Brakes", "Collision", ...),
taken from the FIA classification.

The raw wikitext of each race page is cached under data/raw_cache/wiki/, and the
parsed tables are written to data/parquet/wiki_classification/season=<year>/
classification.parquet, one row per car: position text, car number, laps, the
result cell (a time, "+1 lap", or the retirement cause) and grid slot.

The table is parsed from the page source, not summarised, so every cause can be
traced back to its row on the page.

Usage:
    .venv/bin/python analysis/fetch_causes.py --seasons 2023 2024 2025
"""

import argparse
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw_cache" / "wiki"
OUT = ROOT / "data" / "parquet" / "wiki_classification"
RAW_URL = "https://en.wikipedia.org/w/index.php?title={}&action=raw"
USER_AGENT = "FW47-research/0.1 (personal learning project; one request per race, cached)"
SECONDS_BETWEEN_REQUESTS = 1.0

# A finisher's result cell: a race time, a gap, or laps down.
FINISHED = re.compile(r"^(\d+:\d{2}:\d{2}\.\d+|\+\s*(\d+:)?\d+(\.\d+)?\s*(s|sec)?|\+\s*\d+\s+laps?)$", re.I)


def fetch(title):
    """Raw wikitext of a page, following redirects (e.g. "Emilia Romagna" -> "Emilia-Romagna")."""
    text = _fetch(title)
    m = re.match(r"#REDIRECT\s*\[\[([^\]]+)\]\]", text, re.I)
    return fetch(m.group(1).replace(" ", "_")) if m else text


def _fetch(title):
    path = CACHE / f"{title}.txt"
    if path.exists():
        return path.read_text()
    req = urllib.request.Request(RAW_URL.format(urllib.parse.quote(title)), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode()
    time.sleep(SECONDS_BETWEEN_REQUESTS)
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return text


def strip(cell):
    """Wiki markup -> plain text: drop the cell's style prefix, templates, links and refs."""
    cell = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", cell, flags=re.S)
    if "|" in cell and not cell.lstrip().startswith(("[[", "{{")):
        head, rest = cell.split("|", 1)
        if "=" in head or not head.strip():        # 'style="..." |value' or 'data-sort-value=x |value'
            cell = rest
    cell = re.sub(r"\{\{abbr\|([^|}]*)\|[^}]*\}\}", r"\1", cell)
    cell = re.sub(r"\{\{(ref|note|flagicon|Flagicon|efn|sup)[^}]*\}\}", "", cell)
    cell = re.sub(r"\{\{[^|}]*\|([^}]*)\}\}", r"\1", cell)
    cell = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", cell)
    cell = re.sub(r"'{2,}|<[^>]+>", "", cell)
    return cell.strip()


def race_table(text):
    """The race-classification table (not qualifying or sprint) as rows of cells."""
    m = re.search(r"^=+\s*(Race classification|Race)\s*=+\s*$", text, re.M)
    if m is None:
        raise ValueError("no race classification section")
    body = text[m.end():]
    body = body[body.index("{|"):]
    body = body[:body.index("\n|}")]
    rows = []
    for chunk in body.split("\n|-")[1:]:
        cells = []
        for line in chunk.split("\n")[1:]:
            if line.startswith(("!", "|")) and not line.startswith(("|+", "|}")):
                cells += [c for c in re.split(r"\|\||!!", line[1:])]
        cells = [strip(c) for c in cells]
        if len(cells) >= 7 and cells[1].isdigit():
            rows.append(cells)
    return rows


def parse(text):
    out = []
    for c in race_table(text):
        pos, number, driver, constructor, laps, result, grid = c[:7]
        out.append(dict(pos_text=pos, driver_number=int(number), driver=driver, constructor=constructor,
                        laps=int(laps) if laps.isdigit() else None, result=result, grid=grid))
    return pd.DataFrame(out)


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--seasons", type=int, nargs="+", required=True)
    args = p.parse_args()
    for season in args.seasons:
        races = (pd.read_parquet(ROOT / "data" / "parquet" / "jolpica_results" / f"season={season}" / "results.parquet")
                 .drop_duplicates("round")[["season", "round", "race_name", "race_date"]])
        tables = []
        for r in races.itertuples():
            title = f"{season} {r.race_name}".replace(" ", "_")
            t = parse(fetch(title)).assign(season=season, round=r.round, race_name=r.race_name, race_date=r.race_date)
            t["finished"] = t["result"].str.match(FINISHED)
            tables.append(t)
            print(f"[{season}] {r.race_name}: {len(t)} cars, {(~t['finished']).sum()} not finished", flush=True)
        out = OUT / f"season={season}" / "classification.parquet"
        out.parent.mkdir(parents=True, exist_ok=True)
        pd.concat(tables, ignore_index=True).to_parquet(out, index=False)


if __name__ == "__main__":
    main()
