#!/usr/bin/env python3
"""Generates a static HTML page per word under words/<slug>.html, so every
word has real, unique, crawlable content (title, meta description, full
stage-by-stage breakdown) in the raw HTML response instead of everything
being built client-side. The interactive map itself is built by app.js
on top of this (the same code as the home page); the text is pre-baked.

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
        middle_html = "and was adopted directly into English"
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

    question = f'<span class="origin-question">Where does the word &quot;{esc(word)}&quot; come from?</span>'
    return f"{question} It comes from {first_html}, {middle_html} ({esc(last['era'])})."


def sentence(text):
    """Capitalizes a note fragment into a standalone sentence."""
    text = text.strip()
    if not text:
        return ""
    text = text[0].upper() + text[1:]
    if text[-1] not in ".!?":
        text += "."
    return text


def is_redundant_note(note, meaning):
    """True if a note is just a bare restatement of the meaning field
    ('meaning "time"' alongside meaning: "time") rather than adding any
    real context — appending it as its own sentence would just repeat
    what the opening/connector sentence already said."""
    n = note.strip().strip('"').strip()
    m = meaning.strip().strip('"').strip()
    for prefix in ("meaning ", "means "):
        if n.lower().startswith(prefix):
            n = n[len(prefix):].strip().strip('"').strip()
            return n.lower() == m.lower()
    return False


def note_sentence(stop):
    note = stop.get("note")
    if not note or is_redundant_note(note, stop.get("meaning", "")):
        return ""
    return esc(sentence(note))


MIDDLE_CONNECTORS = [
    "By {era}, the word had taken hold in {lang} as {form}.",
    "From there it passed into {lang} as {form} by {era}.",
    "{lang} picked it up next, as {form}, around {era}.",
]

# Used instead when a stage shares its language with the one right before
# it (e.g. German Zeit -> German Zeitgeist) — the MIDDLE_CONNECTORS phrasing
# implies arriving in a new language, which reads wrong for what's really a
# word formed within a language it was already in.
SAME_LANG_CONNECTORS = [
    "Within {lang}, it grew into {form} by {era}.",
    "By {era}, {lang} speakers had reshaped it into {form}.",
]


def build_narrative(word, stops, current_meaning):
    """A short, plainly-written paragraph synthesized entirely from the
    stops data already on hand (no new research) — real connected prose
    for visitors who want the story, sitting collapsed by default so it
    never competes with the at-a-glance stage cards for attention."""
    display_word = word[0].upper() + word[1:]
    first, last = stops[0], stops[-1]
    middles = stops[1:-1]

    parts = []
    opening = (
        f'{esc(display_word)}’s story begins in {esc(first["lang"])}: '
        f'<em>{esc(first["word"])}</em> meant “{esc(first["meaning"])}.”'
    )
    parts.append(opening)
    parts.append(note_sentence(first))

    prev_lang = first["lang"]
    for i, stop in enumerate(middles):
        connectors = SAME_LANG_CONNECTORS if stop["lang"] == prev_lang else MIDDLE_CONNECTORS
        template = connectors[i % len(connectors)]
        line = (
            template.replace("{era}", esc(stop["era"]))
            .replace("{lang}", esc(stop["lang"]))
            .replace("{form}", f'<em>{esc(stop["word"])}</em>')
        )
        parts.append(line)
        parts.append(note_sentence(stop))
        prev_lang = stop["lang"]

    parts.append(
        f'It reached English by {esc(last["era"])} as <em>{esc(last["word"])}</em>.'
    )
    parts.append(note_sentence(last))

    meaning_clause = current_meaning.strip().rstrip(".")
    if meaning_clause:
        meaning_clause = meaning_clause[0].lower() + meaning_clause[1:]
    parts.append(f'Today, {esc(word)} means {esc(meaning_clause)}.')
    return " ".join(p for p in parts if p)


def _absolutize(html):
    """Turn the home page's relative asset links into root-absolute ones, so the
    same markup works from /words/<slug>."""
    return re.sub(
        r'(href|src)="(?!/|https?:|#|mailto:|data:)([^"]+)"',
        lambda m: f'{m.group(1)}="/{m.group(2)}"',
        html,
    )


def render_word_page(word, entry, word_index):
    """A word page is the home page's result view, pre-filled for one word: the
    same header, map/globe frame, stage cards and story, so a page never looks
    or behaves differently from a search result. The headline, route chips and
    all the text (visually hidden) are in the raw HTML for crawlers and for a
    layout that does not jump when the scripts arrive."""
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

    html = (ROOT / "index.html").read_text(encoding="utf-8")

    # --- head metadata
    html = re.sub(r"<title>.*?</title>", f"<title>{esc(title)}</title>", html, count=1, flags=re.S)
    html = re.sub(r'<meta name="description" content="[^"]*" />', f'<meta name="description" content="{esc(description)}" />', html, count=1)
    html = re.sub(r'<link rel="canonical" href="[^"]*" />', f'<link rel="canonical" href="{canonical}" />', html, count=1)
    html = re.sub(r'<meta property="og:url" content="[^"]*" />', f'<meta property="og:url" content="{canonical}" />', html, count=1)
    html = re.sub(r'<meta property="og:title" content="[^"]*" />', f'<meta property="og:title" content="{esc(title)}" />', html, count=1)
    html = re.sub(r'<meta property="og:description" content="[^"]*" />', f'<meta property="og:description" content="{esc(description)}" />', html, count=1)
    html = re.sub(r'<meta name="twitter:title" content="[^"]*" />', f'<meta name="twitter:title" content="{esc(title)}" />', html, count=1)
    html = re.sub(r'<meta name="twitter:description" content="[^"]*" />', f'<meta name="twitter:description" content="{esc(description)}" />', html, count=1)

    # --- structured data: the home page's WebSite block is swapped for this word's
    # DefinedTerm + breadcrumb (Home > word), so Google can show the breadcrumb trail.
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebPage",
                "@id": f"{canonical}#webpage",
                "url": canonical,
                "name": title,
                "description": description,
                "inLanguage": "en",
                "about": {"@id": f"{canonical}#term"},
                "breadcrumb": {"@id": f"{canonical}#breadcrumb"},
            },
            {
                "@type": "DefinedTerm",
                "@id": f"{canonical}#term",
                "name": word,
                "description": entry["current_meaning"],
                "url": canonical,
                "inDefinedTermSet": {
                    "@type": "DefinedTermSet",
                    "name": "Etymology Map word origins",
                    "url": f"{SITE_URL}/",
                },
            },
            {
                "@type": "BreadcrumbList",
                "@id": f"{canonical}#breadcrumb",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Etymology Map", "item": f"{SITE_URL}/"},
                    {"@type": "ListItem", "position": 2, "name": display_word, "item": canonical},
                ],
            },
        ],
    }
    ld_json = json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")
    html, n_ld = re.subn(
        r'<script type="application/ld\+json" id="ld-json">.*?</script>',
        lambda _m: f'<script type="application/ld+json" id="ld-json">{ld_json}</script>',
        html,
        count=1,
        flags=re.S,
    )
    assert n_ld == 1, "index.html is missing the ld-json block"

    # the home page's descriptive footer text is not repeated on every word page
    html, n_fa = re.subn(r'\s*<p class="footer-about">.*?</p>', "", html, count=1, flags=re.S)
    assert n_fa == 1, "index.html is missing the footer-about paragraph"

    html = _absolutize(html)

    # --- page mode
    html = html.replace("<body>", f'<body data-page="word" data-word="{esc(word)}" data-slug="{slug}">', 1)
    html = html.replace('<div id="app" data-state="landing">', '<div id="app" data-state="result">', 1)
    html = html.replace(
        '<section class="hero">',
        '<section class="hero">\n      <div class="back-wrap"><a class="back-pill" href="/index.html"><span aria-hidden="true">&larr;</span> Back to all words</a></div>',
        1,
    )

    # --- pre-filled headline, so nothing jumps when the scripts arrive
    hero_old = """<div id="result-hero" class="result-hero" hidden>
        <div class="eyebrow">Today it means</div>
        <h2 id="result-word-text" class="result-word"></h2>
        <p id="hero-meaning" class="hero-meaning"></p>
      </div>"""
    assert hero_old in html
    html = html.replace(
        hero_old,
        f'''<div id="result-hero" class="result-hero">
        <div class="eyebrow">Today it means</div>
        <h1 id="result-word-text" class="result-word">{esc(word)}</h1>
        <p id="hero-meaning" class="hero-meaning">{esc(entry["current_meaning"])}</p>
      </div>''',
        1,
    )
    # one h1 per page: the headline word
    html = html.replace('<h1 id="hero-title" class="hero-title">Trace the journey of words</h1>', '<p id="hero-title" class="hero-title">Trace the journey of words</p>', 1)
    chips = []
    for idx, stop in enumerate(stops):
        if idx:
            chips.append('<span class="chip-arrow" aria-hidden="true">&rarr;</span>')
        chips.append(f'<button type="button" class="route-chip" data-idx="{idx}">{esc(stop["word"])}</button>')
    html = html.replace(
        '<div id="route-chips" class="route-chips" aria-label="Stages" hidden></div>',
        f'<div id="route-chips" class="route-chips" aria-label="Stages">{"".join(chips)}</div>',
        1,
    )

    # --- the story, written into the page itself (not a hidden copy)
    # The origin sentence, "Read the full story" panel and related words are in the
    # raw HTML, in the same elements the scripts fill in, so crawlers and visitors
    # see exactly the same text and nothing jumps when the scripts arrive.
    def swap(old, new):
        nonlocal html
        assert html.count(old) == 1, f"template marker missing: {old[:60]}"
        html = html.replace(old, new, 1)

    stage_items = "".join(
        f'<li><span class="ss-label">Stage {i + 1} &middot; {esc(s["lang"])} &middot; {esc(s["era"])}</span>\n'
        f'        <span class="ss-word">{esc(s["word"])}</span>\n'
        f'        <span class="ss-text"><em>"{esc(s["meaning"])}"</em>, {esc(s["note"])}.</span></li>'
        for i, s in enumerate(stops)
    )
    glance_row = lambda k, v: f'<div class="glance-row"><span class="glance-k">{k}</span><span class="glance-v">{v}</span></div>'
    glance = (
        "<h3>At a glance</h3>"
        + glance_row("Origin", esc(stops[0]["lang"]))
        + glance_row("Earliest form", esc(stops[0]["word"]))
        + glance_row("Route", ' <span class="glance-arrow">&rarr;</span> '.join(esc(s["lang"]) for s in stops))
        + glance_row("Entered English", esc(stops[-1]["era"]))
    )
    candidates = sorted(k for k, v in word_index.items() if k != word and v == origin_lang)[:8]
    related = "".join(f'<a class="related-word-item" href="/words/{slugify(w)}">{esc(w)}</a>' for w in candidates)

    swap('<div id="result-area" class="result-area" hidden>', '<div id="result-area" class="result-area">')
    swap(
        '<p id="origin-sentence" class="origin-sentence" hidden></p>',
        f'<p id="origin-sentence" class="origin-sentence">{build_origin_sentence(word, stops)}</p>',
    )
    swap('<details id="full-story" class="full-story" hidden>', '<details id="full-story" class="full-story">')
    swap('<p id="full-story-text"></p>', f'<p id="full-story-text">{build_narrative(word, stops, entry["current_meaning"])}</p>')
    swap('<ol id="story-stages" class="story-stages"></ol>', f'<ol id="story-stages" class="story-stages">{stage_items}</ol>')
    swap(
        '<aside id="story-glance" class="story-glance" aria-label="At a glance"></aside>',
        f'<aside id="story-glance" class="story-glance" aria-label="At a glance">{glance}</aside>',
    )
    if candidates:
        swap('<section id="related-words" class="related-words" hidden>', '<section id="related-words" class="related-words">')
        swap('<span id="related-words-lang"></span>', f'<span id="related-words-lang">{esc(origin_lang)}</span>')
        swap(
            '<div id="related-words-grid" class="related-words-grid"></div>',
            f'<div id="related-words-grid" class="related-words-grid">{related}</div>',
        )

    word_json = json.dumps({"word": word, **entry}, ensure_ascii=False).replace("</", "<\\/")
    swap(
        '<script src="/track.js"></script>',
        f'<script type="application/json" id="word-data">{word_json}</script>\n  <script src="/track.js"></script>',
    )
    return html


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
