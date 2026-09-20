#!/usr/bin/env python3
"""Generates a static HTML page per word under words/<slug>.html, so every
word has real, unique, crawlable content (title, meta description, full
stage-by-stage breakdown) in the raw HTML response instead of everything
being built client-side by word.js. The interactive map itself is still
rendered by word.js on top of this; only the text content is pre-baked.

Run standalone to rebuild every page from data/words/*.json:
    python build_pages.py

Also imported by add_word.py, which calls generate_all() after every word
batch so the static pages always match the data store with zero extra
manual steps.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data" / "words"
INDEX_PATH = ROOT / "data" / "words-index.json"
PAGES_DIR = ROOT / "words"
SITE_URL = "https://etymologymap.com"


def slugify(word):
    s = word.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def esc(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def check_slug_collisions(words):
    by_slug = defaultdict(list)
    for word in words:
        by_slug[slugify(word)].append(word)
    collisions = {slug: ws for slug, ws in by_slug.items() if len(ws) > 1}
    return collisions


def build_origin_sentence(word, stops):
    """A plain-language sentence answering "where does the word X come from?",
    for visitors skimming the page and for search engines matching
    question-phrased searches — same content either way, just phrased as an
    answer instead of left implicit in the stage cards."""
    first, last = stops[0], stops[-1]
    first_html = f'{esc(first["lang"])} <em>{esc(first["word"])}</em>'

    if len(stops) == 2:
        middle_html = "adopted directly into English"
    else:
        langs = []
        for s in stops[1:-1]:
            if not langs or langs[-1] != s["lang"]:
                langs.append(s["lang"])
        if len(langs) == 1:
            passing = esc(langs[0])
        else:
            passing = ", ".join(esc(l) for l in langs[:-1]) + f" and {esc(langs[-1])}"
        middle_html = f"passing through {passing} before entering English"

    return (
        f'Where does the word &quot;{esc(word)}&quot; come from? '
        f"It comes from {first_html}, {middle_html} ({esc(last['era'])})."
    )


def render_word_page(word, entry, word_index):
    slug = slugify(word)
    display_word = word[:1].upper() + word[1:]
    stops = entry["stops"]
    total = len(stops)
    origin_lang = stops[0]["lang"]

    title = f"{display_word} — Etymology & Word Origin | Etymology Map"
    description = (
        f'The etymology of "{word}": trace its journey through {total} language'
        f'{"" if total == 1 else "s"} on its way to English, from {origin_lang} '
        f'to today. Current meaning: {entry["current_meaning"]}'
    )
    canonical = f"{SITE_URL}/words/{slug}"

    stop_rows = []
    for idx, stop in enumerate(stops):
        stop_rows.append(f"""
      <a class="stop-row" href="/words/{slug}?stop={idx + 1}" title="View {esc(stop['word'])}'s stage" data-idx="{idx}">
        <div class="stop-marker">
          <div class="stop-circle">{idx + 1}</div>
          <div class="stop-connector"></div>
        </div>
        <div class="stop-card">
          <div class="stop-order">Stage {idx + 1} of {total}</div>
          <div class="stop-word">{esc(stop['word'])}</div>
          <div class="stop-lang-era">{esc(stop['lang'])} &middot; {esc(stop['era'])}</div>
          <div class="stop-meaning">&quot;{esc(stop['meaning'])}&quot;</div>
          <div class="stop-note">{esc(stop['note'])}</div>
        </div>
      </a>""")
    panel_html = "".join(stop_rows)

    trail_parts = []
    for idx, stop in enumerate(stops):
        if idx > 0:
            trail_parts.append('<span class="trail-arrow">→</span>')
        trail_parts.append(
            f'<a class="trail-item" href="/words/{slug}?stop={idx + 1}" '
            f'title="View {esc(stop["word"])}\'s stage" data-idx="{idx}">{esc(stop["word"])}</a>'
        )
    trail_html = "".join(trail_parts)

    candidates = sorted(k for k, v in word_index.items() if k != word and v == origin_lang)
    picks = candidates[:8]
    related_items = "".join(
        f'<a class="related-word-item" href="/words/{slugify(w)}">{esc(w)}</a>' for w in picks
    )
    related_hidden = "" if picks else " hidden"
    related_html = f"""
    <section id="related-words" class="related-words"{related_hidden}>
      <h2 class="related-words-title">More words from <span id="related-words-lang">{esc(origin_lang)}</span></h2>
      <div id="related-words-grid" class="related-words-grid">{related_items}</div>
    </section>"""

    origin_sentence = build_origin_sentence(word, stops)
    word_json = json.dumps({"word": word, **entry}, ensure_ascii=False)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title id="page-title">{esc(title)}</title>
<meta id="meta-description" name="description" content="{esc(description)}" />
<link rel="canonical" href="{canonical}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="{canonical}" />
<meta id="og-title" property="og:title" content="{esc(title)}" />
<meta id="og-description" property="og:description" content="{esc(description)}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="{esc(title)}" />
<meta name="twitter:description" content="{esc(description)}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="stylesheet" href="/style.css" />
</head>
<body data-word="{esc(word)}" data-slug="{slug}">
  <div id="app">
    <header>
      <div class="header-top">
        <a href="/index.html" class="site-brand">Etymology Map</a>
        <button id="theme-toggle-btn" class="theme-toggle" type="button" aria-label="Switch to dark mode">&#127769;</button>
      </div>
      <a class="back-link" href="/index.html">
        <span class="back-link-arrow" aria-hidden="true">&larr;</span> Back to all words
      </a>
    </header>

    <div id="not-found-msg" class="message" hidden></div>

    <div id="result-header" class="result-header">
      <h1 id="result-word-text" class="result-word">{esc(display_word)}</h1>
      <p id="journey-meta" class="journey-meta">{total} stage{"" if total == 1 else "s"} from {esc(origin_lang)} to English.</p>
      <p id="partial-notice" class="partial-notice" hidden>
        Stage <span id="partial-stage-num"></span> of <span id="partial-stage-total"></span> in
        <a id="partial-full-link" href="/words/{slug}">this word's full journey</a>.
      </p>
      <div id="current-meaning-badge" class="current-meaning">
        <span id="badge-label" class="badge-label">Today it means</span>
        <span id="badge-text" class="badge-text">{esc(entry['current_meaning'])}</span>
      </div>
      <p class="origin-sentence">{origin_sentence}</p>
      <div id="result-trail" class="result-trail">{trail_html}</div>
    </div>

    <main id="result">
      <section id="panel" class="panel">{panel_html}
      </section>
      <section class="map-wrap">
        <div class="map-toolbar">
          <div class="map-toolbar-actions">
            <div class="zoom-controls">
              <button id="zoom-out-btn" title="Zoom out" type="button">&minus;</button>
              <button id="zoom-in-btn" title="Zoom in" type="button">+</button>
              <button id="zoom-reset-btn" title="Reset view" type="button">&#8634;</button>
            </div>
            <span class="toolbar-divider" aria-hidden="true"></span>
            <button id="copy-link-btn" class="icon-btn" type="button" title="Copy a link to this word">&#128279;</button>
            <button id="share-btn" class="share-btn" type="button">Share card</button>
          </div>
        </div>
        <div class="map-canvas">
          <svg id="map" viewBox="0 0 960 500" preserveAspectRatio="xMidYMid meet">
            <g id="zoom-layer">
              <g id="land-layer"></g>
              <g id="path-layer"></g>
            </g>
            <g id="arrow-layer"></g>
            <g id="pin-layer"></g>
          </svg>
        </div>
        <div class="map-hint">Drag to pan &middot; scroll to zoom</div>
      </section>
    </main>
{related_html}
    <div id="share-modal" class="modal-overlay" hidden>
      <div class="modal-card">
        <button id="share-close-btn" class="modal-close" type="button" aria-label="Close">&times;</button>
        <h3 class="modal-title">Share this word's journey</h3>
        <div class="modal-theme-toggle" role="group" aria-label="Card style">
          <button id="share-theme-light-btn" class="modal-theme-btn" type="button" aria-pressed="true">Light</button>
          <button id="share-theme-dark-btn" class="modal-theme-btn" type="button" aria-pressed="false">Dark</button>
        </div>
        <div class="modal-preview-wrap">
          <img id="share-preview" alt="Etymology summary card" />
        </div>
        <div class="modal-actions">
          <button id="share-download-btn" class="modal-btn primary" type="button">Download image</button>
          <button id="share-copy-btn" class="modal-btn" type="button">Copy image</button>
          <button id="share-native-btn" class="modal-btn" type="button">Share&hellip;</button>
        </div>
        <p id="share-status" class="modal-status" hidden></p>
      </div>
    </div>

    <footer class="site-footer">
      <a href="/index.html">Etymology Map</a>
      <a href="/about.html">About</a>
      <a href="/privacy.html">Privacy Policy</a>
    </footer>
  </div>
  <script type="application/json" id="word-data">{word_json}</script>
  <script type="module" src="/word.js"></script>
</body>
</html>
"""


def generate_all(word_index=None, quiet=False):
    """(Re)generates every page under words/ from data/words/*.json. Always
    a full rebuild (not incremental) so template/style changes apply to
    every page consistently, not just newly added words."""
    if word_index is None:
        word_index = json.loads(INDEX_PATH.read_text(encoding="utf-8-sig"))

    words = list(word_index.keys())
    collisions = check_slug_collisions(words)
    if collisions:
        print("ERROR: slug collisions detected, aborting page generation:")
        for slug, ws in collisions.items():
            print(f"  - /{slug} <- {ws}")
        raise SystemExit(1)

    PAGES_DIR.mkdir(exist_ok=True)
    existing_files = {p for p in PAGES_DIR.glob("*.html")}
    written = set()

    for word in words:
        entry = json.loads((DATA_DIR / f"{word}.json").read_text(encoding="utf-8-sig"))
        html = render_word_page(word, entry, word_index)
        out_path = PAGES_DIR / f"{slugify(word)}.html"
        out_path.write_text(html, encoding="utf-8")
        written.add(out_path)

    # Remove stale pages for words that no longer exist in the index.
    stale = existing_files - written
    for path in stale:
        path.unlink()

    if not quiet:
        print(f"Generated {len(written)} word page(s) under words/" + (f", removed {len(stale)} stale" if stale else ""))


if __name__ == "__main__":
    generate_all()
