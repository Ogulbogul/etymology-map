#!/usr/bin/env python3
"""Merge one or more new word entries into the per-word data store, with
basic validation.

Usage:
    python add_word.py new_word_template.json
    python add_word.py path/to/several_words.json

The input file can contain one word or many, in the same shape as a single
word entry:
    { "word": { "stops": [ {...}, {...} ], "current_meaning": "..." }, ... }

Each word is written to its own file under data/words/<word>.json, and
data/words-index.json (word -> origin language, used for search/autocomplete/
word-list/related-words without fetching every word's full data) is
regenerated from every file in data/words/. Words already present are
overwritten (with a warning) so you can also use this to fix an existing
entry. sitemap.xml is also regenerated every run, so search engines can
discover every word page without any separate manual step.
"""
import json
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data" / "words"
INDEX_PATH = ROOT / "data" / "words-index.json"
SITEMAP_PATH = ROOT / "sitemap.xml"
SITE_URL = "https://etymologymap.com"
REQUIRED_STOP_FIELDS = ("word", "lang", "era", "note", "meaning", "lat", "lon")


def write_sitemap(words):
    """Regenerates sitemap.xml from the full word list, so every word page
    stays discoverable to search engines without any manual upkeep — this
    runs automatically every time this script runs, alongside the index."""
    static_pages = ["", "about.html", "privacy.html"]
    urls = [f"{SITE_URL}/{page}" for page in static_pages]
    urls += [
        f"{SITE_URL}/word.html?word={quote(word)}" for word in words
    ]
    entries = "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{entries}\n"
        "</urlset>\n"
    )
    SITEMAP_PATH.write_text(xml, encoding="utf-8")


def validate_entry(word, entry):
    errors = []
    if "stops" not in entry or not isinstance(entry["stops"], list):
        errors.append(f'"{word}": missing "stops" list')
        return errors
    if len(entry["stops"]) < 2:
        errors.append(f'"{word}": needs at least 2 stops to show a journey')
    for i, stop in enumerate(entry["stops"]):
        for field in REQUIRED_STOP_FIELDS:
            if field not in stop:
                errors.append(f'"{word}" stop {i}: missing field "{field}"')
        if "lat" in stop and not (-90 <= stop["lat"] <= 90):
            errors.append(f'"{word}" stop {i}: lat {stop["lat"]} out of range (-90..90)')
        if "lon" in stop and not (-180 <= stop["lon"] <= 180):
            errors.append(f'"{word}" stop {i}: lon {stop["lon"]} out of range (-180..180)')
    if "current_meaning" not in entry or not entry["current_meaning"]:
        errors.append(f'"{word}": missing "current_meaning"')
    return errors


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(f"Input file not found: {input_path}")
        sys.exit(1)

    new_entries = json.loads(input_path.read_text(encoding="utf-8-sig"))

    all_errors = []
    for word, entry in new_entries.items():
        all_errors.extend(validate_entry(word, entry))

    if all_errors:
        print("Validation failed:")
        for e in all_errors:
            print(f"  - {e}")
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    for word, entry in new_entries.items():
        key = word.strip().lower()
        word_path = DATA_DIR / f"{key}.json"
        if word_path.exists():
            print(f'Note: "{key}" already exists — overwriting.')
        word_path.write_text(
            json.dumps(entry, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    index = {}
    for word_path in DATA_DIR.glob("*.json"):
        entry = json.loads(word_path.read_text(encoding="utf-8-sig"))
        index[word_path.stem] = entry["stops"][0]["lang"]
    sorted_index = {k: index[k] for k in sorted(index)}
    INDEX_PATH.write_text(
        json.dumps(sorted_index, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_sitemap(sorted_index)

    print(f"Saved {len(new_entries)} word(s). Collection now has {len(sorted_index)} total.")


if __name__ == "__main__":
    main()
