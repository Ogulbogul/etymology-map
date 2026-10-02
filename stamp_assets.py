"""Adds a version number to every script and stylesheet link, so a changed file is
fetched again right away instead of coming from a browser's cache.

    python3 stamp_assets.py

Looks like:  <script type="module" src="app.js?v=1a2b3c4d">  and  import "./hint.js?v=1a2b3c4d"

The number is a short hash of the contents of all the files listed in ASSETS, so it only changes
when one of them changes. Run it after editing any of those files (add_word.py and
build_pages.py run it for you). It rewrites the references in every .html page and inside the
scripts themselves, and only touches files whose text actually changes.
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

ASSETS = [
    "app.css", "pages.css", "game.css", "style.css",
    "app.js", "page.js", "game.js", "hint.js", "feedback.js", "gamecard.js",
    "icons.js", "globe.js", "sharecard.js", "track.js", "word.js",
    "vendor/d3-geo.js", "vendor/topojson-client.js",
]

VERSION_RE = r"\?v=[0-9a-f]{8}"
REF_RE = re.compile(
    r"([\"'])(\.{0,2}/?)(" + "|".join(re.escape(a) for a in ASSETS) + r")(?:" + VERSION_RE + r")?\1"
)


def _read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def compute_version():
    h = hashlib.sha256()
    for name in sorted(ASSETS):
        path = ROOT / name
        if not path.exists():
            continue
        text = re.sub(VERSION_RE, "", _read(path)).replace("\r\n", "\n")
        h.update(name.encode() + b"\0" + text.encode("utf-8") + b"\0")
    return h.hexdigest()[:8]


def stamp(quiet=False):
    version = compute_version()
    targets = [p for p in ROOT.glob("*.html")] + [p for p in (ROOT / "words").glob("*.html")]
    targets += [ROOT / a for a in ASSETS if (ROOT / a).exists() and not a.startswith("vendor/")]
    changed = 0
    for path in targets:
        text = _read(path)
        new = REF_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={version}{m.group(1)}", text)
        if new != text:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(new)
            changed += 1
    # Stamping adds only the version text, which compute_version ignores, so the number is stable.
    assert compute_version() == version
    if not quiet:
        print(f"Asset version {version}: updated {changed} file(s)")
    return version


if __name__ == "__main__":
    stamp()
