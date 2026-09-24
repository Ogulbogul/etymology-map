#!/usr/bin/env python3
"""Flags stage notes that cite a later-era fact (a technology, medium, or
event) without an explicit time anchor, so it reads as if it happened at
that stop's own era. Real bug found this way: a word's 1600s French stop
said its modern French word "became the word for a film's opening
credits" with no time signal - cinema didn't exist in the 1600s.

Not a hard validator - most hits are false positives (either the note
already anchors the date clearly and this script's keyword/anchor list
is incomplete, or a keyword substring matches inside an unrelated word).
Read every hit before editing anything; only fix genuine cases.

Usage: python check_anachronisms.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def era_year(era):
    era = era.lower()
    m = re.search(r"(\d{3,4})", era)
    if m:
        y = int(m.group(1))
        return -y if "bc" in era else y
    if "ancient" in era:
        return -200
    if "classical" in era:
        return -50
    if "medieval" in era:
        return 1200
    if "prehistoric" in era:
        return -3000
    return None

# keyword (word-boundary regex) -> earliest plausible real-world year for
# what it refers to. Add to this list as new anachronism-prone topics show
# up (radio, computing, internet-era terms, named 20th-century wars, etc).
MODERN_KEYWORDS = {
    r"\bfilm\b": 1895, r"\bcinema\b": 1895, r"\bmovie\b": 1895,
    r"\btelevision\b": 1927, r"\btv\b": 1927, r"\bradio\b": 1900,
    r"\binternet\b": 1990, r"\bcomputer\b": 1945, r"\bsmartphone\b": 2007,
    r"\bautomobile\b": 1900, r"\btelephone\b": 1876, r"\bworld war\b": 1914,
    r"\bairplane\b": 1903, r"\bphotograph\b": 1839, r"\bphotography\b": 1839,
    r"\bdigital\b": 1970, r"\bonline\b": 1990, r"\bwebsite\b": 1995,
    r"\bsocial media\b": 2003, r"\bnuclear\b": 1940, r"\bspace program\b": 1955,
    r"\bastronaut\b": 1959,
}

# wording that already makes a later date unmistakable - skip these
EXPLICIT_ANCHOR = re.compile(
    r"dates? from|came out in|\b(19|20)\d{2}\b|\b1[89]\d0s\b|\bworld war\b|"
    r"later|centuries|eventually|\btoday\b|\bnow\b|modern|subsequently|"
    r"much later|since then",
    re.I,
)


def scan():
    hits = []
    for f in sorted((ROOT / "data" / "words").glob("*.json")):
        entry = json.loads(f.read_text(encoding="utf-8-sig"))
        for i, s in enumerate(entry.get("stops", [])):
            note = s.get("note", "").strip()
            era = s.get("era", "")
            if not note:
                continue
            ey = era_year(era)
            if ey is None:
                continue
            note_l = note.lower()
            if EXPLICIT_ANCHOR.search(note_l):
                continue
            for kw, kw_year in MODERN_KEYWORDS.items():
                if re.search(kw, note_l) and kw_year > ey + 50:
                    hits.append((f.stem, i, era, note))
                    break
    return hits


if __name__ == "__main__":
    hits = scan()
    print(f"{len(hits)} possible unanchored anachronism(s):")
    for word, i, era, note in hits:
        print(f" - {word} (stop {i}, era: {era}) | {note}")
    sys.exit(1 if hits else 0)
