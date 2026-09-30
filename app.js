import { icon, hydrateIcons } from "./icons.js";
import { createGlobe } from "./globe.js";

const MAP_WIDTH = 960;
const MAP_HEIGHT = 500;
const MIN_ZOOM = 1;
const MAX_ZOOM = 14;
const FIT_PADDING = 60;

// Offscreen canvas used only to measure pin-label text width (matches
// .pin-label's CSS font) so overlap checks don't force a synchronous
// layout via getBBox() on every pan/zoom frame.
const labelMeasureCtx = document.createElement("canvas").getContext("2d");
labelMeasureCtx.font = `600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
function measureLabelWidth(text) {
  return labelMeasureCtx.measureText(text).width;
}

function rectsOverlap(a, b) {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

// Same idea as the share card's label placement: try a ring of offsets
// around each pin and use the first one that doesn't overlap a label
// already placed or another pin's dot, so two stops close together on
// the map (e.g. neighboring countries) don't draw illegible overlapping
// text. Cheap enough (a handful of stops, run once per position update)
// to recompute on every pan/zoom frame rather than caching it.
const LABEL_CANDIDATES = [
  { dx: 13, dy: -11, anchor: "start" },
  { dx: 13, dy: 19, anchor: "start" },
  { dx: -13, dy: -11, anchor: "end" },
  { dx: -13, dy: 19, anchor: "end" },
  { dx: 13, dy: -29, anchor: "start" },
  { dx: 13, dy: 37, anchor: "start" },
  { dx: -13, dy: -29, anchor: "end" },
  { dx: -13, dy: 37, anchor: "end" },
];

function placePinLabels(entries, u = 1) {
  const PAD = 4 * u, H = 15 * u, PIN_R = 10 * u;
  const placedBoxes = [];
  return entries.map((entry, i) => {
    let chosen = LABEL_CANDIDATES[0];
    for (const off of LABEL_CANDIDATES) {
      const x = entry.sx + off.dx * u;
      const y = entry.sy + off.dy * u;
      const x1 = off.anchor === "start" ? x : x - entry.w;
      const x2 = off.anchor === "start" ? x + entry.w : x;
      const box = { x1: x1 - PAD, x2: x2 + PAD, y1: y - H - PAD, y2: y + PAD };
      const hitsLabel = placedBoxes.some((p) => rectsOverlap(box, p));
      const hitsOtherPin = entries.some((other, j) => {
        if (j === i) return false;
        return (
          box.x1 < other.sx + PIN_R && box.x2 > other.sx - PIN_R &&
          box.y1 < other.sy + PIN_R && box.y2 > other.sy - PIN_R
        );
      });
      if (!hitsLabel && !hitsOtherPin) {
        chosen = off;
        placedBoxes.push(box);
        break;
      }
    }
    return { ...entry, x: entry.sx + chosen.dx * u, y: entry.sy + chosen.dy * u, anchor: chosen.anchor };
  });
}

const appEl = document.getElementById("app");
const homeLink = document.getElementById("home-link");
const emptyChipsBar = document.getElementById("empty-chips-bar");
const wordInput = document.getElementById("word-input");
const traceBtn = document.getElementById("trace-btn");
const traceIconBtn = document.getElementById("trace-icon-btn");
const hintEl = document.getElementById("hint");
const messageEl = document.getElementById("message");
const heroTitleEl = document.getElementById("hero-title");
const resultHeroEl = document.getElementById("result-hero");
const resultWordTextEl = document.getElementById("result-word-text");
const heroMeaningEl = document.getElementById("hero-meaning");
const cardWordEl = document.getElementById("card-word");
const cardMeaningEl = document.getElementById("card-meaning");
const resultAreaEl = document.getElementById("result-area");
const panelEl = document.getElementById("panel");
const trayEl = document.getElementById("tray");
const mapSvg = document.getElementById("map");
const mapCanvasEl = document.getElementById("map-stage");
const zoomLayer = document.getElementById("zoom-layer");
const landLayer = document.getElementById("land-layer");
const pathLayer = document.getElementById("path-layer");
const arrowLayer = document.getElementById("arrow-layer");
const pinLayer = document.getElementById("pin-layer");
const originSentenceEl = document.getElementById("origin-sentence");
const fullStoryEl = document.getElementById("full-story");
const fullStoryTextEl = document.getElementById("full-story-text");
const globeHintEl = document.getElementById("globe-hint");
const routeChipsEl = document.getElementById("route-chips");
const storyStagesEl = document.getElementById("story-stages");
const storyGlanceEl = document.getElementById("story-glance");
fullStoryEl.addEventListener("toggle", () => {
  if (fullStoryEl.open && lastWord && window.emTrack) window.emTrack.story(lastWord);
});
const relatedWordsEl = document.getElementById("related-words");
const relatedWordsLangEl = document.getElementById("related-words-lang");
const relatedWordsGridEl = document.getElementById("related-words-grid");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const wordlistToggleBtn = document.getElementById("wordlist-toggle-btn");
const wordlistCloseBtn = document.getElementById("wordlist-close-btn");
const wordlistPanel = document.getElementById("wordlist-panel");
const wordlistGrid = document.getElementById("wordlist-grid");
const wordlistOriginSelect = document.getElementById("wordlist-origin-select");
const wordlistCountEl = document.getElementById("wordlist-count");
const surpriseBtn = document.getElementById("surprise-btn");
const copyLinkBtn = document.getElementById("copy-link-btn");
const copyLinkBtnGlobe = document.getElementById("copy-link-btn-globe");
const inputWrap = document.querySelector(".input-wrap");
const autocompleteList = document.getElementById("autocomplete-list");
const originSearchInput = document.getElementById("wordlist-origin-search");
const originSearchWrap = document.querySelector(".origin-search-wrap");
const originAutocompleteList = document.getElementById("origin-autocomplete-list");
const wodCard = document.getElementById("wod-card");
const wodWordEl = document.getElementById("wod-word");
const wodMeaningEl = document.getElementById("wod-meaning");
const wodRouteEl = document.getElementById("wod-route");
const wodTraceBtn = document.getElementById("wod-trace-btn");
const wodShuffleBtn = document.getElementById("wod-shuffle-btn");
const globeHost = document.getElementById("globe-host");
const globeStageEl = document.getElementById("globe-stage");
const globeMotionBtn = document.getElementById("globe-motion-btn");
const globeMotionLabel = document.getElementById("globe-motion-label");
const globeMotionIcon = document.getElementById("globe-motion-icon");
const originPillsEl = document.getElementById("origin-pills");
const browseCountEl = document.getElementById("browse-count");
const footerCountEl = document.getElementById("footer-count");
const mapStageEl = document.getElementById("map-stage");
const viewToggleButtons = document.querySelectorAll(".view-toggle button");

// Lightweight word -> origin-language map covering the whole collection,
// used for search/autocomplete/word-list/did-you-mean without fetching
// every word's full stop-by-stop data. A specific word's full entry is
// fetched on demand (see fetchWordEntry) only once it's actually traced.
let wordIndex = {};
let allOrigins = [];
let originCounts = new Map();
let projectPoint = manualProject; // overwritten if the real map loads

// Kept so the share card can redraw the same coastlines without refetching.
let mapLandFeature = null;
let mapProjection = null;
let d3geoModule = null;

// The most recently traced word, so the Share button (which only appears
// once a result is showing) knows what to render.
let lastWord = null;
let lastEntry = null;
let lastPoints = null;

// Pan/zoom state. The zoom-layer group (land + route lines) is transformed
// as translate(x, y) scale(k); pins live outside that group and are
// repositioned manually each frame so their size stays constant on screen.
const view = { x: 0, y: 0, k: 1 };
let viewAnimFrame = null;

// New in the redesign: the optional globe view, the selected stage, and
// the random "Try this word" shown on the landing page.
let globe = null;
let globeUnavailable = false;
let currentView = "map";
let selectedStop = -1;
let wod = null; // { word, entry }
const VIEW_STORAGE_KEY = "etymology-map-view";

function slugify(word) {
  return word
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function manualProject(lon, lat) {
  const x = ((lon + 180) / 360) * MAP_WIDTH;
  const y = ((90 - lat) / 180) * MAP_HEIGHT;
  return [x, y];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function loadWordIndex() {
  try {
    const res = await fetch("data/words-index.json");
    wordIndex = await res.json();
  } catch (err) {
    wordIndex = {};
    console.error("Could not load data/words-index.json", err);
  }
  const count = Object.keys(wordIndex).length;
  hintEl.textContent = `${count} word${count === 1 ? "" : "s"} in this collection so far`;
  populateWordList();
}

// Fetches one word's full stop-by-stop data on demand, so tracing a word
// only ever downloads that one small file rather than the whole collection.
// Resolves to null when the word genuinely isn't in the collection (404) and
// throws when the data couldn't be loaded (network down, server error), so
// the page can show "no match" and "couldn't load" as different states.
class LoadError extends Error {}
async function fetchWordEntry(word) {
  let res;
  try {
    res = await fetch(`data/words/${encodeURIComponent(word)}.json`);
  } catch (err) {
    throw new LoadError(String(err));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new LoadError(`HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (err) {
    throw new LoadError(String(err));
  }
}

// A word's "origin" is the language of its very first stop, the
// earliest point in its traced journey.
function originOf(word) {
  return wordIndex[word] || null;
}

function populateWordList() {
  const counts = new Map();
  Object.keys(wordIndex).forEach((word) => {
    const origin = originOf(word);
    if (origin) counts.set(origin, (counts.get(origin) || 0) + 1);
  });
  originCounts = counts;
  // Biggest origins first; ties fall back to alphabetical.
  allOrigins = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));

  wordlistOriginSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = `All origins (${Object.keys(wordIndex).length})`;
  wordlistOriginSelect.appendChild(allOption);
  allOrigins.forEach((origin) => {
    const opt = document.createElement("option");
    opt.value = origin;
    opt.textContent = `${origin} (${counts.get(origin)})`;
    wordlistOriginSelect.appendChild(opt);
  });

  renderOriginPills();
  updateCounts();
  renderWordList("");
}

function renderWordList(originFilter) {
  wordlistGrid.innerHTML = "";
  const words = Object.keys(wordIndex)
    .filter((word) => !originFilter || originOf(word) === originFilter)
    .sort((a, b) => a.localeCompare(b));

  if (words.length === 0) {
    wordlistGrid.classList.add("empty");
    wordlistGrid.textContent = "No words with that origin yet.";
  } else {
    wordlistGrid.classList.remove("empty");
    words.forEach((word) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wordlist-item";
      btn.textContent = word;
      btn.title = word;
      btn.addEventListener("click", () => {
        wordInput.value = word;
        trace();
        closeWordList();
      });
      wordlistGrid.appendChild(btn);
    });
  }

  wordlistCountEl.textContent = `${words.length} word${words.length === 1 ? "" : "s"}`;
}

function openWordList() {
  wordlistPanel.hidden = false;
  wordlistToggleBtn.setAttribute("aria-expanded", "true");
  appEl.classList.add("sheet-open");
}

function closeWordList() {
  wordlistPanel.hidden = true;
  wordlistToggleBtn.setAttribute("aria-expanded", "false");
  appEl.classList.remove("sheet-open");
}

function setupWordList() {
  wordlistToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (wordlistPanel.hidden) openWordList();
    else closeWordList();
  });
  wordlistCloseBtn.addEventListener("click", closeWordList);
  // The notch closes the phone sheet with a swipe down (a tap does nothing).
  const handle = wordlistPanel.querySelector(".sheet-handle");
  let dragY = null;
  handle.addEventListener("pointerdown", (e) => { dragY = e.clientY; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener("pointerup", (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragY;
    dragY = null;
    if (dy > 40) closeWordList();
  });
  handle.addEventListener("pointercancel", () => { dragY = null; });
  wordlistOriginSelect.addEventListener("change", () => {
    originSearchInput.value = wordlistOriginSelect.value;
    renderWordList(wordlistOriginSelect.value);
  });
  // Click outside or Escape closes the popover (the phone sheet too).
  document.addEventListener("click", (e) => {
    if (wordlistPanel.hidden) return;
    if (wordlistPanel.contains(e.target) || wordlistToggleBtn.contains(e.target)) return;
    closeWordList();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wordlistPanel.hidden) closeWordList();
  });
}

// Browse-by-origin pills and the word counters.
function renderOriginPills() {
  originPillsEl.innerHTML = "";
  const top = [...originCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10);
  top.forEach(([origin]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "origin-pill";
    btn.textContent = origin;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      wordlistOriginSelect.value = origin;
      originSearchInput.value = origin;
      renderWordList(origin);
      openWordList();
      wordlistPanel.scrollIntoView({ block: "nearest" });
    });
    originPillsEl.appendChild(btn);
  });
}

function updateCounts() {
  const count = Object.keys(wordIndex).length;
  const text = `${count.toLocaleString()} word${count === 1 ? "" : "s"} traced`;
  browseCountEl.textContent = text;
  footerCountEl.textContent = `${text} \u00b7 Etymology Map`;
}

// --- Origin search (for the long origin list) ---------------------------
// Same prefix/substring-match dropdown pattern as the word autocomplete,
// but selecting an entry sets the origin filter instead of tracing a word.

let originAcMatches = [];
let originAcActiveIndex = -1;

function getOriginMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    // Focused with nothing typed: offer the biggest origins first.
    return [...originCounts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 8).map(([o]) => o);
  }
  const starts = [];
  const contains = [];
  allOrigins.forEach((origin) => {
    const lower = origin.toLowerCase();
    if (lower.startsWith(q)) starts.push(origin);
    else if (lower.includes(q)) contains.push(origin);
  });
  return [...starts, ...contains].slice(0, 8);
}

function renderOriginAutocomplete() {
  originAutocompleteList.innerHTML = "";
  if (originAcMatches.length === 0) {
    originAutocompleteList.hidden = true;
    originSearchInput.setAttribute("aria-expanded", "false");
    return;
  }
  originAcMatches.forEach((origin, idx) => {
    const li = document.createElement("li");
    li.className = "autocomplete-item";
    li.id = `origin-autocomplete-item-${idx}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", idx === originAcActiveIndex ? "true" : "false");
    if (idx === originAcActiveIndex) li.classList.add("active");
    li.textContent = `${origin} (${originCounts.get(origin) || 0})`;
    li.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      selectOrigin(origin);
    });
    originAutocompleteList.appendChild(li);
  });
  originAutocompleteList.hidden = false;
  originSearchInput.setAttribute("aria-expanded", "true");
}

function selectOrigin(origin) {
  wordlistOriginSelect.value = origin;
  originSearchInput.value = origin;
  closeOriginAutocomplete();
  renderWordList(origin);
}

function closeOriginAutocomplete() {
  originAcMatches = [];
  originAcActiveIndex = -1;
  originAutocompleteList.hidden = true;
  originAutocompleteList.innerHTML = "";
  originSearchInput.setAttribute("aria-expanded", "false");
}

function setupOriginSearch() {
  originSearchInput.addEventListener("focus", () => {
    if (originSearchInput.value.trim()) return;
    originAcMatches = getOriginMatches("");
    originAcActiveIndex = -1;
    renderOriginAutocomplete();
  });
  originSearchInput.addEventListener("input", () => {
    originAcMatches = getOriginMatches(originSearchInput.value);
    originAcActiveIndex = -1;
    renderOriginAutocomplete();
    // Clearing the box resets the filter live, rather than leaving the
    // grid stuck on whatever origin was last selected.
    if (!originSearchInput.value.trim() && wordlistOriginSelect.value !== "") {
      wordlistOriginSelect.value = "";
      renderWordList("");
    }
  });

  originSearchInput.addEventListener("keydown", (e) => {
    if (originAcMatches.length > 0 && e.key === "ArrowDown") {
      e.preventDefault();
      originAcActiveIndex = (originAcActiveIndex + 1) % originAcMatches.length;
      renderOriginAutocomplete();
      return;
    }
    if (originAcMatches.length > 0 && e.key === "ArrowUp") {
      e.preventDefault();
      originAcActiveIndex = (originAcActiveIndex - 1 + originAcMatches.length) % originAcMatches.length;
      renderOriginAutocomplete();
      return;
    }
    if (e.key === "Escape" && originAcMatches.length > 0) {
      closeOriginAutocomplete();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (originAcActiveIndex >= 0 && originAcMatches[originAcActiveIndex]) {
        selectOrigin(originAcMatches[originAcActiveIndex]);
      } else if (originAcMatches.length === 1) {
        selectOrigin(originAcMatches[0]);
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (!originSearchWrap.contains(e.target)) closeOriginAutocomplete();
  });
}

// Clicking the site title resets the page to a blank slate: empty search
// box, no result shown, no ?word= left in the URL — even if you're already
// on the homepage mid-search. A real href is kept on the link itself so
// right-click/open-in-new-tab/middle-click still behave normally; only a
// plain left click is intercepted to do this in place instead of reloading.
function resetToHome() {
  closeAutocomplete();
  closeWordList();
  wordInput.value = "";
  clearResult();
  clearMessage();
  const url = new URL(window.location.href);
  url.search = "";
  history.pushState({}, "", url);
  // Skip on mobile widths: focusing the input pops the virtual keyboard,
  // which is jarring right after a navigation the user didn't ask to type
  // into. Desktop keeps the focus so the cursor is ready to type.
  if (window.innerWidth >= 600) wordInput.focus();
}

function setupHomeLink() {
  homeLink.addEventListener("click", (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    resetToHome();
  });
}

// Example-word chips shown in the empty state (before any trace), so a
// first-time visitor has something to click instead of a blank strip.
// Picked fresh each time the empty state appears: one random word per
// random distinct origin language, so repeat visits (and every trip back
// to the homepage) show a different, still-varied set rather than always
// the same six words or six words that happen to share one origin.
function pickExampleWords(count) {
  const byOrigin = new Map();
  Object.entries(wordIndex).forEach(([word, origin]) => {
    if (!byOrigin.has(origin)) byOrigin.set(origin, []);
    byOrigin.get(origin).push(word);
  });
  const origins = [...byOrigin.keys()];
  for (let i = origins.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [origins[i], origins[j]] = [origins[j], origins[i]];
  }
  return origins.slice(0, count).map((origin) => {
    const words = byOrigin.get(origin);
    return words[Math.floor(Math.random() * words.length)];
  });
}

function renderExampleChips() {
  if (!emptyChipsBar) return;
  emptyChipsBar.querySelectorAll(".example-chip").forEach((el) => el.remove());
  const count = window.innerWidth <= 640 ? 2 : 6;
  pickExampleWords(count).forEach((word) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "example-chip";
    btn.textContent = word;
    btn.addEventListener("click", () => {
      wordInput.value = word;
      trace();
    });
    emptyChipsBar.appendChild(btn);
  });
}

function setupSurprise() {
  surpriseBtn.addEventListener("click", () => {
    const keys = Object.keys(wordIndex);
    if (keys.length === 0) return;
    let pick = keys[Math.floor(Math.random() * keys.length)];
    if (keys.length > 1) {
      while (pick === lastWord) {
        pick = keys[Math.floor(Math.random() * keys.length)];
      }
    }
    wordInput.value = pick;
    trace();
  });
}

async function loadMap() {
  try {
    const [d3geo, topojsonClient, landResp] = await Promise.all([
      import("./vendor/d3-geo.js"),
      import("./vendor/topojson-client.js"),
      fetch("vendor/land-110m.json"),
    ]);
    if (!landResp.ok) throw new Error("land topology fetch failed");
    const topology = await landResp.json();
    const land = topojsonClient.feature(topology, topology.objects.land);
    const projection = d3geo
      .geoEquirectangular()
      .fitSize([MAP_WIDTH, MAP_HEIGHT], land);
    const pathGen = d3geo.geoPath(projection);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", pathGen(land));
    pathEl.setAttribute("class", "land-path");
    landLayer.appendChild(pathEl);

    projectPoint = (lon, lat) => projection([lon, lat]);
    mapLandFeature = land;
    mapProjection = projection;
    d3geoModule = d3geo;

    globe = createGlobe({
      host: globeHost,
      d3geo,
      land,
      onSelect: (i) => selectStop(i),
      onHover: (i, on) => setActive(i, on),
    });
  } catch (err) {
    console.warn("Falling back to manual projection; world map coastlines unavailable.", err);
    projectPoint = manualProject;
    globeUnavailable = true;
    document.documentElement.classList.add("no-globe");
  }
}

function clearMessage() {
  messageEl.hidden = true;
  messageEl.innerHTML = "";
}

// Plain iterative Levenshtein (edit distance) over two small strings,
// cheap enough to run against the whole word list on every miss with no
// external dependency or ongoing maintenance cost.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function findSuggestions(raw, maxSuggestions = 3) {
  const threshold = raw.length <= 4 ? 1 : raw.length <= 7 ? 2 : 3;
  return Object.keys(wordIndex)
    .map((word) => ({ word, dist: levenshtein(raw, word) }))
    .filter((s) => s.dist > 0 && s.dist <= threshold)
    .sort((a, b) => a.dist - b.dist || a.word.localeCompare(b.word))
    .slice(0, maxSuggestions)
    .map((s) => s.word);
}

function messageCard(iconName, title, text) {
  messageEl.innerHTML = "";
  const ic = document.createElement("span");
  ic.className = "msg-icon";
  ic.innerHTML = icon(iconName, 26);
  const t = document.createElement("span");
  t.className = "msg-title";
  t.textContent = title;
  messageEl.append(ic, t, document.createTextNode(text));
}

function showNotFound(displayWord, raw) {
  messageCard(
    "circle-help",
    `No match for \u201c${displayWord}\u201d`,
    "That word isn't in the collection yet. Check the spelling, or explore another way."
  );
  const suggestions = findSuggestions(raw);
  if (suggestions.length > 0) {
    const wrap = document.createElement("span");
    wrap.className = "message-suggestions";
    wrap.appendChild(document.createTextNode("Did you mean "));
    suggestions.forEach((sg) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestion-link";
      btn.textContent = sg;
      btn.addEventListener("click", () => {
        wordInput.value = sg;
        trace();
      });
      wrap.appendChild(btn);
    });
    messageEl.appendChild(wrap);
  }
  const actions = document.createElement("div");
  actions.className = "message-actions";
  const sur = document.createElement("button");
  sur.type = "button";
  sur.className = "btn btn-primary";
  sur.textContent = "Surprise me";
  sur.addEventListener("click", () => surpriseBtn.click());
  const wl = document.createElement("button");
  wl.type = "button";
  wl.className = "btn btn-outline";
  wl.textContent = "Browse the word list";
  wl.addEventListener("click", (e) => {
    e.stopPropagation();
    openWordList();
  });
  actions.append(sur, wl);
  messageEl.appendChild(actions);
  messageEl.hidden = false;
}

function showLoadError(retry) {
  messageCard(
    "triangle-alert",
    "Couldn't load the word data",
    "Something went wrong while loading. Check your connection and try again."
  );
  const actions = document.createElement("div");
  actions.className = "message-actions";
  const again = document.createElement("button");
  again.type = "button";
  again.className = "btn btn-primary";
  again.textContent = "Try again";
  again.addEventListener("click", () => {
    clearMessage();
    retry();
  });
  actions.appendChild(again);
  messageEl.appendChild(actions);
  messageEl.hidden = false;
}

// Empties everything a traced word put on the page, without touching the
// landing-page extras (the "Try this word" preview).
function clearResultContent() {
  panelEl.innerHTML = "";
  trayEl.innerHTML = "";
  trayEl.hidden = true;
  pathLayer.innerHTML = "";
  arrowLayer.innerHTML = "";
  pinLayer.innerHTML = "";
  originSentenceEl.hidden = true;
  originSentenceEl.innerHTML = "";
  fullStoryEl.hidden = true;
  fullStoryEl.open = false;
  fullStoryTextEl.innerHTML = "";
  storyStagesEl.innerHTML = "";
  storyGlanceEl.innerHTML = "";
  routeChipsEl.innerHTML = "";
  routeChipsEl.hidden = true;
  relatedWordsEl.hidden = true;
  relatedWordsGridEl.innerHTML = "";
  resultAreaEl.hidden = true;
  selectedStop = -1;
  if (globe) globe.clearRoute();
}

// Back to the landing page: no result, and the random word's route shown
// as a preview on whichever view is active.
function clearResult() {
  clearResultContent();
  appEl.dataset.state = "landing";
  resultHeroEl.hidden = true;
  setView({ x: 0, y: 0, k: 1 });
  renderExampleChips();
  syncGlobeVariant();
  applyLandingPreview();
}

function setActive(index, isActive) {
  const row = panelEl.querySelector(`.stop-row[data-idx="${index}"]`);
  const pin = pinLayer.querySelector(`.pin-group[data-idx="${index}"]`);
  const tray = trayEl.querySelector(`.tray-item[data-idx="${index}"]`);
  [row, pin, tray].forEach((el) => el && el.classList.toggle("active", isActive));
  if (globe) globe.setHover(isActive ? index : -1);
}

// Clicking a stage card, tray chip or pin selects it everywhere at once.
function selectStop(index) {
  selectedStop = selectedStop === index ? -1 : index;
  panelEl.querySelectorAll(".stop-row").forEach((el) => {
    const on = Number(el.dataset.idx) === selectedStop;
    el.classList.toggle("selected", on);
    el.setAttribute("aria-pressed", on ? "true" : "false");
  });
  trayEl.querySelectorAll(".tray-item").forEach((el) => el.classList.toggle("selected", Number(el.dataset.idx) === selectedStop));
  pinLayer.querySelectorAll(".pin-group").forEach((el) => el.classList.toggle("selected", Number(el.dataset.idx) === selectedStop));
  routeChipsEl.querySelectorAll(".route-chip").forEach((el) => el.classList.toggle("selected", Number(el.dataset.idx) === selectedStop));
  if (globe) globe.setSelected(selectedStop);
}

// --- Pan & zoom -----------------------------------------------------------

// Keeps at least PAN_MARGIN world-units of the map inside the viewBox at
// all times, so dragging or zoom-panning can never push the whole map
// offscreen. Bounds are derived from the current zoom: at k=1 (map exactly
// fills the viewBox) this caps how far you can drag; at high zoom the map
// is far larger than the viewBox, so the same margin barely constrains
// panning at all, which is the expected feel.
const PAN_MARGIN = 150;

function clampView(next) {
  const k = clamp(next.k, MIN_ZOOM, MAX_ZOOM);
  const minX = PAN_MARGIN - MAP_WIDTH * k;
  const maxX = MAP_WIDTH - PAN_MARGIN;
  const minY = PAN_MARGIN - MAP_HEIGHT * k;
  const maxY = MAP_HEIGHT - PAN_MARGIN;
  return {
    x: clamp(next.x, minX, maxX),
    y: clamp(next.y, minY, maxY),
    k,
  };
}

function setView(next) {
  const clamped = clampView(next);
  view.x = clamped.x;
  view.y = clamped.y;
  view.k = clamped.k;
  zoomLayer.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
  updatePinPositions();
  updateArrowPositions();
}

// Pins and labels are sized in screen pixels, but the map is drawn in a
// fixed 960x500 coordinate space that the browser scales to fit, so
// everything measured in pixels is converted to map units with this.
function mapScale() {
  const r = mapSvg.getBoundingClientRect();
  if (!r.width || !r.height) return 1;
  return Math.max(r.width / MAP_WIDTH, r.height / MAP_HEIGHT);
}

function updatePinPositions() {
  const u = 1 / mapScale();
  const small = mapSvg.getBoundingClientRect().width < 520;
  const groups = Array.from(pinLayer.querySelectorAll(".pin-group"));
  const entries = groups.map((g) => {
    const cx = parseFloat(g.dataset.cx);
    const cy = parseFloat(g.dataset.cy);
    return {
      g,
      sx: view.k * cx + view.x,
      sy: view.k * cy + view.y,
      w: (parseFloat(g.dataset.labelWidth) || 0) * u,
    };
  });
  const placed = placePinLabels(entries, u);
  placed.forEach(({ g, sx, sy, x, y, anchor }) => {
    const preview = g.classList.contains("preview");
    const isOn = g.classList.contains("active") || g.classList.contains("selected");
    const rPx = (isOn ? 10 : preview ? 9.5 : 8) * (small ? 0.85 : 1);
    const circle = g.querySelector(".pin-dot");
    const halo = g.querySelector(".pin-halo");
    const num = g.querySelector(".pin-num");
    const label = g.querySelector(".pin-label");
    circle.setAttribute("cx", sx);
    circle.setAttribute("cy", sy);
    circle.setAttribute("r", rPx * u);
    circle.setAttribute("stroke-width", 1.5 * u);
    halo.setAttribute("cx", sx);
    halo.setAttribute("cy", sy);
    halo.setAttribute("r", rPx * 1.9 * u);
    num.setAttribute("x", sx);
    num.setAttribute("y", sy);
    num.setAttribute("font-size", Math.max(9, rPx * 1.3) * u);
    label.setAttribute("x", x);
    label.setAttribute("y", y);
    label.setAttribute("text-anchor", anchor);
    label.setAttribute("font-size", 15 * u);
    label.setAttribute("stroke-width", 4 * u);
  });
}

function updateArrowPositions() {
  arrowLayer.querySelectorAll(".route-arrow").forEach((arrow) => {
    const cx = parseFloat(arrow.dataset.cx);
    const cy = parseFloat(arrow.dataset.cy);
    const angle = parseFloat(arrow.dataset.angle);
    const sx = view.k * cx + view.x;
    const sy = view.k * cy + view.y;
    arrow.setAttribute("transform", `translate(${sx} ${sy}) rotate(${angle})`);
  });
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateViewTo(target, duration = 700) {
  if (viewAnimFrame) clearTimeout(viewAnimFrame);
  const start = { ...view };
  const startTime = performance.now();

  function step() {
    const t = clamp((performance.now() - startTime) / duration, 0, 1);
    const eased = easeInOutCubic(t);
    setView({
      x: start.x + (target.x - start.x) * eased,
      y: start.y + (target.y - start.y) * eased,
      k: start.k + (target.k - start.k) * eased,
    });
    if (t < 1) viewAnimFrame = setTimeout(step, 16);
    else viewAnimFrame = null;
  }
  viewAnimFrame = setTimeout(step, 0);
}

function computeFitView(points, opts = {}) {
  if (points.length === 0) return { x: 0, y: 0, k: 1 };
  // The svg fills its card ("slice"), so what's visible can be a
  // sub-rectangle of the 960x500 space: fit the route inside that.
  const r = mapSvg.getBoundingClientRect();
  let visW = MAP_WIDTH;
  let visH = MAP_HEIGHT;
  if (r.width && r.height) {
    const aspect = r.width / r.height;
    if (aspect >= MAP_WIDTH / MAP_HEIGHT) visH = MAP_WIDTH / aspect;
    else visW = MAP_HEIGHT * aspect;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(([px, py]) => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  });
  const bboxW = Math.max(maxX - minX, 1);
  const bboxH = Math.max(maxY - minY, 1);
  // Leave room at the bottom for the stage tray on the desktop card.
  const padX = FIT_PADDING;
  const padLeft = opts.padLeft || 0;
  const padTop = FIT_PADDING * 0.8;
  const padBottom = trayEl.hidden ? FIT_PADDING * 0.8 : FIT_PADDING * 1.6;
  const k = clamp(
    Math.min((visW - 2 * padX - padLeft) / bboxW, (visH - padTop - padBottom) / bboxH),
    MIN_ZOOM,
    opts.maxK || MAX_ZOOM
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const centreY = MAP_HEIGHT / 2 + (padTop - padBottom) / 2;
  return { x: MAP_WIDTH / 2 + padLeft / 2 - k * cx, y: centreY - k * cy, k };
}

function toSvgPoint(evt) {
  const pt = mapSvg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = mapSvg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

function zoomAroundPoint(point, factor) {
  const newK = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const worldX = (point.x - view.x) / view.k;
  const worldY = (point.y - view.y) / view.k;
  setView({ x: point.x - worldX * newK, y: point.y - worldY * newK, k: newK });
}

function setupPanZoom() {
  // Tracks every finger/pointer currently down on the map, keyed by
  // pointerId, in SVG viewBox coordinates. One active pointer pans; two
  // pins to pinch-zoom (distance-ratio between them each move, applied as
  // an incremental factor around their midpoint, same as a wheel tick).
  const activePointers = new Map();
  let dragStart = null;
  let viewAtDragStart = null;
  let pinchPrevDist = null;

  function activePoints() {
    return [...activePointers.values()];
  }
  function pointDist(p1, p2) {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  function pointMid(p1, p2) {
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }
  function beginSingleDrag() {
    dragStart = activePoints()[0];
    viewAtDragStart = { ...view };
  }

  mapSvg.addEventListener("pointerdown", (e) => {
    if (viewAnimFrame) {
      clearTimeout(viewAnimFrame);
      viewAnimFrame = null;
    }
    try {
      mapSvg.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some browsers reject capturing a pointer mid-gesture (e.g. the
      // second finger of a pinch); tracking below still works without it.
    }
    activePointers.set(e.pointerId, toSvgPoint(e));
    mapCanvasEl.classList.add("dragging");

    if (activePointers.size === 1) {
      beginSingleDrag();
      pinchPrevDist = null;
    } else if (activePointers.size === 2) {
      dragStart = null;
      const [p1, p2] = activePoints();
      pinchPrevDist = pointDist(p1, p2);
    }
  });

  mapSvg.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, toSvgPoint(e));

    if (activePointers.size >= 2) {
      const [p1, p2] = activePoints();
      const d = pointDist(p1, p2);
      if (pinchPrevDist) zoomAroundPoint(pointMid(p1, p2), d / pinchPrevDist);
      pinchPrevDist = d;
    } else if (activePointers.size === 1 && dragStart) {
      const cur = activePoints()[0];
      setView({
        x: viewAtDragStart.x + (cur.x - dragStart.x),
        y: viewAtDragStart.y + (cur.y - dragStart.y),
        k: viewAtDragStart.k,
      });
    }
  });

  function releasePointer(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      mapCanvasEl.classList.remove("dragging");
      dragStart = null;
      pinchPrevDist = null;
    } else if (activePointers.size === 1) {
      beginSingleDrag();
      pinchPrevDist = null;
    }
  }
  mapSvg.addEventListener("pointerup", releasePointer);
  mapSvg.addEventListener("pointercancel", releasePointer);

  mapSvg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const point = toSvgPoint(e);
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      zoomAroundPoint(point, factor);
    },
    { passive: false }
  );

  zoomInBtn.addEventListener("click", () => zoomAroundCenter(1.4));
  zoomOutBtn.addEventListener("click", () => zoomAroundCenter(1 / 1.4));
  zoomResetBtn.addEventListener("click", () => animateViewTo({ x: 0, y: 0, k: 1 }));
}

function zoomAroundCenter(factor) {
  zoomAroundPoint({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 }, factor);
}

// --- Rendering --------------------------------------------------------

// Mirrors build_origin_sentence() in build_pages.py, so a word traced from
// the homepage's own search box reads identically to its static permalink
// page instead of missing this content entirely.
function buildOriginSentence(word, stops) {
  const first = stops[0];
  const last = stops[stops.length - 1];
  const firstHtml = `${escapeHtml(first.lang)} <em>${escapeHtml(first.word)}</em>`;

  let middleHtml;
  if (stops.length === 2) {
    middleHtml = "and was adopted directly into English";
  } else {
    const langs = [];
    stops.slice(1, -1).forEach((s) => {
      if (!langs.length || langs[langs.length - 1] !== s.lang) langs.push(s.lang);
    });
    const passing =
      langs.length === 1
        ? escapeHtml(langs[0])
        : langs
            .slice(0, -1)
            .map(escapeHtml)
            .join(", ") + ` and ${escapeHtml(langs[langs.length - 1])}`;
    middleHtml = `passing through ${passing} before entering English`;
  }

  const question = `<span class="origin-question">Where does the word &quot;${escapeHtml(word)}&quot; come from?</span>`;
  return `${question} It comes from ${firstHtml}, ${middleHtml} (${escapeHtml(last.era)}).`;
}

function sentenceCase(text) {
  const t = text.trim();
  if (!t) return "";
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

// True if a note is just a bare restatement of the meaning field
// ('meaning "time"' alongside meaning: "time") rather than adding any real
// context — appending it as its own sentence would just repeat what the
// opening/connector sentence already said.
function isRedundantNote(note, meaning) {
  let n = note.trim().replace(/^"|"$/g, "").trim();
  const m = meaning.trim().replace(/^"|"$/g, "").trim().toLowerCase();
  const lower = n.toLowerCase();
  for (const prefix of ["meaning ", "means "]) {
    if (lower.startsWith(prefix)) {
      n = n.slice(prefix.length).trim().replace(/^"|"$/g, "").trim();
      return n.toLowerCase() === m;
    }
  }
  return false;
}

function noteSentence(stop) {
  if (!stop.note || isRedundantNote(stop.note, stop.meaning || "")) return "";
  return escapeHtml(sentenceCase(stop.note));
}

const MIDDLE_CONNECTORS = [
  "By {era}, the word had taken hold in {lang} as {form}.",
  "From there it passed into {lang} as {form} by {era}.",
  "{lang} picked it up next, as {form}, around {era}.",
];

// Used instead when a stage shares its language with the one right before
// it — the MIDDLE_CONNECTORS phrasing implies arriving in a new language,
// which reads wrong for a word formed within a language it was already in.
const SAME_LANG_CONNECTORS = [
  "Within {lang}, it grew into {form} by {era}.",
  "By {era}, {lang} speakers had reshaped it into {form}.",
];

// Mirrors build_narrative() in build_pages.py.
function buildNarrative(word, stops, currentMeaning) {
  const displayWord = word[0].toUpperCase() + word.slice(1);
  const first = stops[0];
  const last = stops[stops.length - 1];
  const middles = stops.slice(1, -1);
  const parts = [];

  parts.push(
    `${escapeHtml(displayWord)}’s story begins in ${escapeHtml(first.lang)}: ` +
      `<em>${escapeHtml(first.word)}</em> meant “${escapeHtml(first.meaning)}.”`
  );
  parts.push(noteSentence(first));

  let prevLang = first.lang;
  middles.forEach((stop, i) => {
    const connectors = stop.lang === prevLang ? SAME_LANG_CONNECTORS : MIDDLE_CONNECTORS;
    const template = connectors[i % connectors.length];
    const line = template
      .replace("{era}", escapeHtml(stop.era))
      .replace("{lang}", escapeHtml(stop.lang))
      .replace("{form}", `<em>${escapeHtml(stop.word)}</em>`);
    parts.push(line);
    parts.push(noteSentence(stop));
    prevLang = stop.lang;
  });

  parts.push(`It reached English by ${escapeHtml(last.era)} as <em>${escapeHtml(last.word)}</em>.`);
  parts.push(noteSentence(last));

  let meaningClause = currentMeaning.trim().replace(/\.$/, "");
  if (meaningClause) meaningClause = meaningClause[0].toLowerCase() + meaningClause.slice(1);
  parts.push(`Today, ${escapeHtml(word)} means ${escapeHtml(meaningClause)}.`);

  return parts.filter(Boolean).join(" ");
}

function pickRandom(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// Mirrors renderRelatedWords() in word.js, so tracing a word from the
// homepage offers the same "keep exploring" incentive near the bottom of
// the results as its static permalink page does, instead of only having
// discovery tools (word list, autocomplete, surprise me) up at the top.
function renderRelatedWords(baseWord, originLang) {
  const candidates = Object.keys(wordIndex).filter(
    (key) => key !== baseWord && wordIndex[key] === originLang
  );
  if (candidates.length === 0) {
    relatedWordsEl.hidden = true;
    return;
  }

  const picks = pickRandom(candidates, 8).sort((a, b) => a.localeCompare(b));
  relatedWordsLangEl.textContent = originLang;
  relatedWordsGridEl.innerHTML = "";
  picks.forEach((key) => {
    const a = document.createElement("a");
    a.className = "related-word-item";
    a.href = `/words/${slugify(key)}`;
    a.textContent = key;
    relatedWordsGridEl.appendChild(a);
  });
  relatedWordsEl.hidden = false;
}

// Draws the route (dashed lines, midpoint arrows, pins) on the flat map.
// "preview" is the small, label-light version used for the landing page's
// word of the day.
function drawMapRoute(stops, { preview = false } = {}) {
  pathLayer.innerHTML = "";
  arrowLayer.innerHTML = "";
  pinLayer.innerHTML = "";
  const points = stops.map((s) => projectPoint(s.lon, s.lat));

  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("class", "route-line");
    pathLayer.appendChild(line);

    if (!preview) {
      // Arrowhead at the segment midpoint (not the endpoint) so it's clearly
      // visible in open space instead of being crowded next to the pin.
      const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
      arrow.setAttribute("class", "route-arrow");
      arrow.setAttribute("d", "M -5,-5 L 6,0 L -5,5");
      arrow.dataset.cx = String((x1 + x2) / 2);
      arrow.dataset.cy = String((y1 + y2) / 2);
      arrow.dataset.angle = String(angleDeg);
      arrowLayer.appendChild(arrow);
    }
  }

  stops.forEach((stop, idx) => {
    const [x, y] = points[idx];
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", preview ? "pin-group preview" : "pin-group");
    g.dataset.idx = String(idx);
    g.dataset.cx = String(x);
    g.dataset.cy = String(y);
    g.dataset.labelWidth = String(measureLabelWidth(stop.word));

    const halo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    halo.setAttribute("class", "pin-halo");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", "pin-dot");
    const num = document.createElementNS("http://www.w3.org/2000/svg", "text");
    num.setAttribute("class", "pin-num");
    num.setAttribute("dy", ".35em");
    num.textContent = String(idx + 1);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "pin-label");
    label.textContent = stop.word;
    if (preview && idx !== 0 && idx !== stops.length - 1) label.style.display = "none";

    g.append(halo, circle, num, label);
    if (!preview) {
      g.addEventListener("mouseenter", () => setActive(idx, true));
      g.addEventListener("mouseleave", () => setActive(idx, false));
      g.addEventListener("click", () => selectStop(idx));
    }
    pinLayer.appendChild(g);
  });
  return points;
}

function shortLang(lang) {
  const parts = lang.split(" ");
  return parts[parts.length - 1];
}

function renderStoryExtras(word, entry) {
  const stops = entry.stops;
  const first = stops[0];
  const last = stops[stops.length - 1];
  storyStagesEl.innerHTML = stops
    .map(
      (s, i) => `<li><span class="ss-label">Stage ${i + 1} &middot; ${escapeHtml(s.lang)} &middot; ${escapeHtml(s.era)}</span>
        <span class="ss-word">${escapeHtml(s.word)}</span>
        <span class="ss-text"><em>"${escapeHtml(s.meaning)}"</em>, ${escapeHtml(s.note)}.</span></li>`
    )
    .join("");
  const route = stops.map((s) => escapeHtml(shortLang(s.lang) === "Turkish" ? s.lang : s.lang));
  const row = (k, v) => `<div class="glance-row"><span class="glance-k">${k}</span><span class="glance-v">${v}</span></div>`;
  storyGlanceEl.innerHTML =
    `<h3>At a glance</h3>` +
    row("Origin", escapeHtml(first.lang)) +
    row("Earliest form", escapeHtml(first.word)) +
    row("Route", route.join(' <span class="glance-arrow">&rarr;</span> ')) +
    row("Entered English", escapeHtml(last.era));
  routeChipsEl.innerHTML = stops
    .map((s, i) => `${i ? '<span class="chip-arrow" aria-hidden="true">&rarr;</span>' : ""}<button type="button" class="route-chip" data-idx="${i}">${escapeHtml(s.word)}</button>`)
    .join("");
  routeChipsEl.querySelectorAll(".route-chip").forEach((b) => b.addEventListener("click", () => selectStop(Number(b.dataset.idx))));
  routeChipsEl.hidden = false;
}

function renderWord(word, entry) {
  clearResultContent();
  clearMessage();
  appEl.dataset.state = "result";
  resultHeroEl.hidden = false;
  resultAreaEl.hidden = false;
  resultWordTextEl.textContent = word;
  heroMeaningEl.textContent = entry.current_meaning;
  cardWordEl.textContent = word;
  cardMeaningEl.textContent = entry.current_meaning;
  cardMeaningEl.title = entry.current_meaning;
  const total = entry.stops.length;

  entry.stops.forEach((stop, idx) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "stop-row";
    row.dataset.idx = String(idx);
    row.setAttribute("aria-pressed", "false");
    row.innerHTML = `
      <span class="stop-circle">${idx + 1}</span>
      <span class="stop-body">
        <span class="stop-order">Stage ${idx + 1} of ${total}</span>
        <span class="stop-main">
          <span class="stop-word">${escapeHtml(stop.word)}</span>
          <span class="stop-lang-era">${escapeHtml(stop.lang)} &middot; ${escapeHtml(stop.era)}</span>
        </span>
        <span class="stop-sub">
          <span class="stop-meaning">"${escapeHtml(stop.meaning)}"</span>
          <span class="stop-note">${escapeHtml(stop.note)}</span>
        </span>
      </span>
    `;
    row.addEventListener("click", () => selectStop(idx));
    row.addEventListener("mouseenter", () => setActive(idx, true));
    row.addEventListener("mouseleave", () => setActive(idx, false));
    panelEl.appendChild(row);

    const item = document.createElement("button");
    item.type = "button";
    item.className = "tray-item";
    item.dataset.idx = String(idx);
    item.innerHTML = `<span class="tray-num">${idx + 1}</span><span class="tray-word">${escapeHtml(stop.word)}</span><span class="tray-lang">${escapeHtml(shortLang(stop.lang))}</span>`;
    item.addEventListener("click", () => selectStop(idx));
    item.addEventListener("mouseenter", () => setActive(idx, true));
    item.addEventListener("mouseleave", () => setActive(idx, false));
    trayEl.appendChild(item);
  });
  trayEl.hidden = false;

  const points = drawMapRoute(entry.stops);
  lastWord = word;
  lastEntry = entry;
  lastPoints = points;

  setView({ x: 0, y: 0, k: 1 });
  animateViewTo(computeFitView(points));
  if (globe) globe.setStops(entry.stops, { animate: true });

  originSentenceEl.innerHTML = buildOriginSentence(word, entry.stops);
  originSentenceEl.hidden = false;
  fullStoryTextEl.innerHTML = buildNarrative(word, entry.stops, entry.current_meaning);
  fullStoryEl.hidden = false;
  renderStoryExtras(word, entry);

  renderRelatedWords(word, entry.stops[0].lang);
  hydrateIcons(resultAreaEl);
}

// --- Landing page: the random "Try this word" ------------------------------

function renderWodCard() {
  if (!wod) return;
  wodWordEl.textContent = wod.word;
  wodMeaningEl.textContent = wod.entry.current_meaning || "";
  const langs = [];
  wod.entry.stops.forEach((s) => {
    if (!langs.length || langs[langs.length - 1] !== s.lang) langs.push(s.lang);
  });
  wodRouteEl.innerHTML = langs.map((l) => escapeHtml(l)).join(` ${icon("arrow-right", 13)} `);
}

// Draws the word of the day's route on the active view, so the landing
// page already shows a journey being tracked.
function applyLandingPreview() {
  if (appEl.dataset.state !== "landing" || !wod) return;
  const points = drawMapRoute(wod.entry.stops, { preview: true });
  // Zoom in on the word's route, leaving the "Try this word" card clear.
  const phone = window.innerWidth <= 640;
  const padLeft = phone ? 0 : (338 / mapScale());
  setView(computeFitView(points, { padLeft, maxK: 5 }));
  if (globe) globe.setStops(wod.entry.stops, { animate: false, labels: true });
}

// One word per UTC day, the same for every visitor: hash the date into the
// sorted word list, then step forward to the first entry that has a route.
function dailyCandidates() {
  const keys = Object.keys(wordIndex).sort();
  const day = new Date().toISOString().slice(0, 10);
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const start = keys.length ? h % keys.length : 0;
  return Array.from({ length: Math.min(12, keys.length) }, (_, i) => keys[(start + i) % keys.length]);
}

async function pickDailyWod() {
  for (const word of dailyCandidates()) {
    try {
      const entry = await fetchWordEntry(word);
      if (entry && entry.stops && entry.stops.length > 1) {
        wod = { word, entry };
        renderWodCard();
        applyLandingPreview();
        return;
      }
    } catch (err) {
      return;
    }
  }
  await pickWod();
}

async function pickWod(exclude) {
  const keys = Object.keys(wordIndex).filter((w) => w !== exclude);
  if (keys.length === 0) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    const word = keys[Math.floor(Math.random() * keys.length)];
    try {
      const entry = await fetchWordEntry(word);
      if (entry && entry.stops && entry.stops.length > 1) {
        wod = { word, entry };
        renderWodCard();
        applyLandingPreview();
        return;
      }
    } catch (err) {
      return;
    }
  }
}

function setupWod() {
  wodTraceBtn.addEventListener("click", () => {
    if (!wod) return;
    wordInput.value = wod.word;
    trace();
  });
  wodShuffleBtn.addEventListener("click", () => pickWod(wod && wod.word));
}

// --- Map or globe ---------------------------------------------------------

// The word-of-the-day card sits on the flat map in map view and on the
// globe in globe view.
function placeWodCard() {
  const host = currentView === "globe" ? globeStageEl : mapStageEl;
  if (wodCard.parentElement !== host) host.appendChild(wodCard);
}

function setMapView(view, { save = true } = {}) {
  if (view === "globe" && globeUnavailable) view = "map";
  const changed = view !== currentView;
  currentView = view;
  document.documentElement.setAttribute("data-view", view);
  if (changed && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const root = document.documentElement;
    root.classList.remove("view-to-globe", "view-to-map");
    void root.offsetWidth;
    root.classList.add(view === "globe" ? "view-to-globe" : "view-to-map");
    setTimeout(() => root.classList.remove("view-to-globe", "view-to-map"), 1500);
  }
  viewToggleButtons.forEach((b) => b.setAttribute("aria-checked", b.dataset.view === view ? "true" : "false"));
  if (save) {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch (err) { /* private mode */ }
  }
  placeWodCard();
  // The hidden view has no size while hidden, so measure again now.
  requestAnimationFrame(() => {
    updatePinPositions();
    if (globe) {
      globe.setVariant(window.innerWidth >= 961 ? "rise" : "full");
      globe.resize();
      if (changed && view === "globe") globe.spinIn();
    }
  });
}

const HINT_KEY = "etymology-map-drag-hint";
function setupDragHint() {
  let seen = false;
  try { seen = localStorage.getItem(HINT_KEY) === "1"; } catch (err) { seen = false; }
  if (seen) { globeHintEl.hidden = true; return; }
  globeHost.addEventListener("globe-drag", () => {
    globeHintEl.classList.add("gone");
    try { localStorage.setItem(HINT_KEY, "1"); } catch (err) { /* private mode */ }
  });
}

function setupViewToggle() {
  setupDragHint();
  let saved = null;
  try { saved = localStorage.getItem(VIEW_STORAGE_KEY); } catch (err) { saved = null; }
  viewToggleButtons.forEach((b) => b.addEventListener("click", () => setMapView(b.dataset.view)));
  currentView = saved === "globe" ? "globe" : "map";
  globeMotionBtn.addEventListener("click", () => {
    const paused = !(globe && globe.isPaused());
    if (globe) globe.setPaused(paused);
    globeMotionBtn.setAttribute("aria-pressed", paused ? "true" : "false");
    globeMotionLabel.textContent = paused ? "Paused" : "Slowly rotating";
    globeMotionIcon.innerHTML = icon(paused ? "play" : "pause", 13);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Shareable links --------------------------------------------------
// Every trace (typed, suggested, from the word list, or surprise-me)
// updates ?word= in the URL so the page itself is a shareable link.
// Loads triggered by that param (initial page load, or the back/forward
// buttons) use replaceState instead, so they don't pile up new history.

function updateUrlForWord(word, replace) {
  const url = new URL(window.location.href);
  url.searchParams.set("word", word);
  if (replace) history.replaceState({ word }, "", url);
  else history.pushState({ word }, "", url);
}

async function trace(options = {}) {
  closeAutocomplete();
  closeWordList();
  const displayWord = wordInput.value.trim();
  const raw = displayWord.toLowerCase();
  if (!raw) return;
  updateUrlForWord(raw, !!options.fromUrl);
  let entry;
  try {
    entry = await fetchWordEntry(raw);
  } catch (err) {
    clearResult();
    showLoadError(() => trace(options));
    return;
  }
  if (!entry) {
    clearResult();
    showNotFound(displayWord, raw);
    if (window.emTrack) window.emTrack.miss(raw);
    return;
  }
  renderWord(raw, entry);
  syncGlobeVariant();
  if (window.emTrack) window.emTrack.view(raw);

}

function syncGlobeVariant() {
  if (!globe) return;
  const rise = window.innerWidth >= 961;
  globe.setVariant(rise ? "rise" : "full", false);
}

function initFromUrl() {
  const word = new URLSearchParams(window.location.search).get("word");
  if (!word) return;
  wordInput.value = word;
  trace({ fromUrl: true });
}

window.addEventListener("popstate", () => {
  const word = new URLSearchParams(window.location.search).get("word");
  if (word) {
    wordInput.value = word;
    trace({ fromUrl: true });
  } else {
    wordInput.value = "";
    clearResult();
    clearMessage();
  }
});

// --- Autocomplete -------------------------------------------------------
// A small prefix-match dropdown under the input. Selection uses
// pointerdown (not click) so it fires before the input's blur, avoiding
// the usual race where a blur-triggered close eats the click.

let acMatches = [];
let acActiveIndex = -1;

function getAutocompleteMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return Object.keys(wordIndex)
    .filter((word) => word.toLowerCase().startsWith(q))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, 8);
}

function renderAutocomplete() {
  autocompleteList.innerHTML = "";
  if (acMatches.length === 0) {
    autocompleteList.hidden = true;
    wordInput.setAttribute("aria-expanded", "false");
    return;
  }
  acMatches.forEach((word, idx) => {
    const li = document.createElement("li");
    li.className = "autocomplete-item";
    li.id = `autocomplete-item-${idx}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", idx === acActiveIndex ? "true" : "false");
    if (idx === acActiveIndex) li.classList.add("active");
    li.textContent = word;
    li.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      selectAutocomplete(word);
    });
    autocompleteList.appendChild(li);
  });
  autocompleteList.hidden = false;
  wordInput.setAttribute("aria-expanded", "true");
}

function selectAutocomplete(word) {
  wordInput.value = word;
  trace();
}

function closeAutocomplete() {
  acMatches = [];
  acActiveIndex = -1;
  autocompleteList.hidden = true;
  autocompleteList.innerHTML = "";
  wordInput.setAttribute("aria-expanded", "false");
}

function setupAutocomplete() {
  wordInput.addEventListener("input", () => {
    acMatches = getAutocompleteMatches(wordInput.value);
    acActiveIndex = -1;
    renderAutocomplete();
  });

  wordInput.addEventListener("keydown", (e) => {
    if (acMatches.length > 0 && e.key === "ArrowDown") {
      e.preventDefault();
      acActiveIndex = (acActiveIndex + 1) % acMatches.length;
      renderAutocomplete();
      return;
    }
    if (acMatches.length > 0 && e.key === "ArrowUp") {
      e.preventDefault();
      acActiveIndex = (acActiveIndex - 1 + acMatches.length) % acMatches.length;
      renderAutocomplete();
      return;
    }
    if (e.key === "Escape" && acMatches.length > 0) {
      closeAutocomplete();
      return;
    }
    if (e.key === "Enter") {
      if (acActiveIndex >= 0 && acMatches[acActiveIndex]) {
        e.preventDefault();
        selectAutocomplete(acMatches[acActiveIndex]);
      } else {
        trace();
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (!inputWrap.contains(e.target)) closeAutocomplete();
  });
}

traceBtn.addEventListener("click", () => trace());

// --- Share card ---------------------------------------------------------
// Renders a self-contained PNG (word, its stage-by-stage forms, and a
// cropped map of the route) onto an offscreen <canvas>, so it can be
// downloaded, copied, or handed to the OS share sheet. Reuses the same
// land geometry and lon/lat projection already loaded for the live map.

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const CARD_FONT = `-apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
const CARD_COLORS_LIGHT = {
  bg: "#fdfbf8",
  ocean: "#eef3f4",
  land: "#eae7de",
  border: "#e3e1db",
  text: "#2a2a28",
  dim: "#6b6a64",
  accent: "#b3541e",
};
const CARD_COLORS_DARK = {
  bg: "#17140f",
  ocean: "#1c1811",
  land: "#2b271e",
  border: "#3a352c",
  text: "#f1ece2",
  dim: "#a89e8c",
  accent: "#e2934f",
};

function getCardColors(theme) {
  return theme === "dark" ? CARD_COLORS_DARK : CARD_COLORS_LIGHT;
}

const shareBtn = document.getElementById("share-btn");
const shareModal = document.getElementById("share-modal");
const sharePreview = document.getElementById("share-preview");
const shareThemeLightBtn = document.getElementById("share-theme-light-btn");
const shareThemeDarkBtn = document.getElementById("share-theme-dark-btn");
const shareDownloadBtn = document.getElementById("share-download-btn");
const shareCopyBtn = document.getElementById("share-copy-btn");
const shareNativeBtn = document.getElementById("share-native-btn");
const shareCloseBtn = document.getElementById("share-close-btn");
const shareStatusEl = document.getElementById("share-status");

let currentShareBlob = null;
let currentPreviewUrl = null;
let shareCardTheme = "light";

function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const test = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  });
  if (current) lines.push(current);
  return lines;
}

// Same as wrapCanvasText, but if the text needs more than maxLines it
// ellipsizes the last visible line instead of silently dropping the
// remainder - a wrapped-and-clipped sentence with no visual cue reads as
// a typo, not "there's more".
function wrapCanvasTextClamped(ctx, text, maxWidth, maxLines) {
  const lines = wrapCanvasText(ctx, text, maxWidth);
  if (lines.length <= maxLines) return lines;
  const clamped = lines.slice(0, maxLines);
  let last = clamped[maxLines - 1];
  while (last.length > 0 && ctx.measureText(last + "…").width > maxWidth) {
    last = last.slice(0, -1);
  }
  clamped[maxLines - 1] = last.replace(/\s+$/, "") + "…";
  return clamped;
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

function fitCanvasFontSize(ctx, text, maxWidth, startSize, minSize, weight) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${CARD_FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  }
  return size;
}

// Picks a crop rectangle (in the map's own 0..960 x 0..500 space) that
// contains every stop with padding, matching the panel's aspect ratio so
// the coastlines don't stretch.
function computeCropRect(points, panelW, panelH, padding = 40) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(([px, py]) => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  });
  const paddedW = Math.max(maxX - minX, 1) + padding * 2;
  const paddedH = Math.max(maxY - minY, 1) + padding * 2;
  const panelAspect = panelW / panelH;

  let srcW, srcH;
  if (paddedW / paddedH > panelAspect) {
    srcW = Math.min(paddedW, MAP_WIDTH);
    srcH = srcW / panelAspect;
  } else {
    srcH = Math.min(paddedH, MAP_HEIGHT);
    srcW = srcH * panelAspect;
  }
  if (srcW > MAP_WIDTH) {
    srcW = MAP_WIDTH;
    srcH = srcW / panelAspect;
  }
  if (srcH > MAP_HEIGHT) {
    srcH = MAP_HEIGHT;
    srcW = srcH * panelAspect;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const srcX = clamp(cx - srcW / 2, 0, Math.max(0, MAP_WIDTH - srcW));
  const srcY = clamp(cy - srcH / 2, 0, Math.max(0, MAP_HEIGHT - srcH));
  return { srcX, srcY, srcW, srcH };
}

function rectsOverlapCard(a, b) {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

// Greedy label placement for the pins drawn on the share-card canvas:
// try a ring of offsets around each pin and use the first that doesn't
// overlap a label already placed or another pin, so two stops close
// together on the map (e.g. neighboring countries) don't draw illegible
// overlapping text. A pin with no collision-free spot left falls back to
// a small numbered badge instead of forcing an overlapping label.
const CARD_LABEL_CANDIDATES = [
  { dx: 10, dy: -8, align: "left" },
  { dx: 10, dy: 18, align: "left" },
  { dx: -10, dy: -8, align: "right" },
  { dx: -10, dy: 18, align: "right" },
  { dx: 10, dy: -26, align: "left" },
  { dx: 10, dy: 36, align: "left" },
  { dx: -10, dy: -26, align: "right" },
  { dx: -10, dy: 36, align: "right" },
];

function placeCardLabels(ctx, entries, font, pinExclusionR = 9) {
  ctx.font = font;
  const PAD = 4, H = 13;
  const placedBoxes = [];
  return entries.map((entry, i) => {
    const w = ctx.measureText(entry.text).width;
    for (const off of CARD_LABEL_CANDIDATES) {
      const x = entry.sx + off.dx;
      const y = entry.sy + off.dy;
      const x1 = off.align === "left" ? x : x - w;
      const x2 = off.align === "left" ? x + w : x;
      const box = { x1: x1 - PAD, x2: x2 + PAD, y1: y - H - PAD, y2: y + PAD };
      const hitsLabel = placedBoxes.some((p) => rectsOverlapCard(box, p));
      const hitsOtherPin = entries.some((other, j) => {
        if (j === i) return false;
        return (
          box.x1 < other.sx + pinExclusionR && box.x2 > other.sx - pinExclusionR &&
          box.y1 < other.sy + pinExclusionR && box.y2 > other.sy - pinExclusionR
        );
      });
      if (!hitsLabel && !hitsOtherPin) {
        placedBoxes.push(box);
        return { ...entry, x, y, align: off.align, hidden: false };
      }
    }
    return { ...entry, hidden: true };
  });
}

// The site's favicon, reused as a brand mark next to the site link on the
// card. Loaded once and cached since it's the same asset every render.
let shareCardIconPromise = null;
function loadShareCardIcon() {
  if (!shareCardIconPromise) {
    shareCardIconPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // draw without the icon if it fails to load
      img.src = "/share-card-mark.svg";
    });
  }
  return shareCardIconPromise;
}

async function buildShareCard(word, entry, points, colors) {
  const favicon = await loadShareCardIcon();

  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const padding = 48;
  const leftW = 420;
  const mapX = padding + leftW + 28;
  const mapY = padding;
  const mapW = CARD_WIDTH - mapX - padding;
  const mapH = CARD_HEIGHT - padding * 2;

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mapX - 28, padding);
  ctx.lineTo(mapX - 28, CARD_HEIGHT - padding);
  ctx.stroke();

  // --- Left column: title, meaning, stage list -----------------------
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.accent;
  ctx.font = `700 13px ${CARD_FONT}`;
  ctx.fillText("ETYMOLOGY MAP", padding, padding + 12);

  let y = padding + 68;
  const displayWord = word.charAt(0).toUpperCase() + word.slice(1);
  const titleSize = fitCanvasFontSize(ctx, displayWord, leftW, 60, 36, "700");
  ctx.fillStyle = colors.text;
  ctx.font = `700 ${titleSize}px ${CARD_FONT}`;
  ctx.fillText(displayWord, padding, y);

  y += 34;
  ctx.fillStyle = colors.dim;
  ctx.font = `400 15px ${CARD_FONT}`;
  wrapCanvasTextClamped(ctx, entry.current_meaning, leftW, 2).forEach((line) => {
    ctx.fillText(line, padding, y);
    y += 20;
  });
  y += 20;

  const rowsRemaining = CARD_HEIGHT - padding - 46 - y;
  const rowGap = Math.max(58, Math.min(72, rowsRemaining / entry.stops.length));
  entry.stops.forEach((stop, idx) => {
    // circleCenterY is the single shared vertical anchor for the circle,
    // its number, and the stage word - using textBaseline "middle" for
    // all three guarantees they line up regardless of font size, instead
    // of eyeballed baseline offsets that drift out of alignment.
    const circleCenterY = y + idx * rowGap;

    ctx.beginPath();
    ctx.arc(padding + 10, circleCenterY, 10, 0, Math.PI * 2);
    ctx.fillStyle = colors.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.accent;
    ctx.stroke();
    ctx.fillStyle = colors.accent;
    ctx.font = `700 11px ${CARD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(idx + 1), padding + 10, circleCenterY + 1);
    ctx.textAlign = "left";

    if (idx < entry.stops.length - 1) {
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padding + 10, circleCenterY + 11);
      ctx.lineTo(padding + 10, circleCenterY + rowGap - 11);
      ctx.stroke();
    }

    ctx.fillStyle = colors.text;
    ctx.font = `700 17px ${CARD_FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText(stop.word, padding + 32, circleCenterY);
    const wordWidth = ctx.measureText(stop.word).width;
    ctx.fillStyle = colors.accent;
    ctx.font = `700 12px ${CARD_FONT}`;
    ctx.fillText(`${stop.lang.toUpperCase()} · ${stop.era}`, padding + 32 + wordWidth + 10, circleCenterY);
    ctx.textBaseline = "alphabetic";

    const flavor = stop.note || stop.meaning;
    ctx.fillStyle = colors.dim;
    ctx.font = `italic 400 13px ${CARD_FONT}`;
    ctx.fillText(truncateToWidth(ctx, flavor, leftW - 32), padding + 32, circleCenterY + 26);
  });

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, CARD_HEIGHT - 46);
  ctx.lineTo(padding + leftW, CARD_HEIGHT - 46);
  ctx.stroke();

  // tagline stays under the stage list, bottom-left of the left column
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.dim;
  ctx.font = `400 12px ${CARD_FONT}`;
  ctx.fillText("Trace any word's journey", padding, CARD_HEIGHT - 22);

  // --- Right column: cropped map with pins, lines, arrows -------------
  ctx.fillStyle = colors.ocean;
  ctx.fillRect(mapX, mapY, mapW, mapH);

  const crop = computeCropRect(points, mapW, mapH);

  if (mapLandFeature && mapProjection && d3geoModule) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapW, mapH);
    ctx.clip();
    const scaleX = mapW / crop.srcW;
    const scaleY = mapH / crop.srcH;
    ctx.translate(mapX - crop.srcX * scaleX, mapY - crop.srcY * scaleY);
    ctx.scale(scaleX, scaleY);
    const canvasPathGen = d3geoModule.geoPath(mapProjection, ctx);
    ctx.beginPath();
    canvasPathGen(mapLandFeature);
    ctx.fillStyle = colors.land;
    ctx.fill();
    ctx.restore();
  }

  function childToScreen(cx, cy) {
    return [mapX + (cx - crop.srcX) * (mapW / crop.srcW), mapY + (cy - crop.srcY) * (mapH / crop.srcH)];
  }

  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < points.length - 1; i++) {
    const [sx1, sy1] = childToScreen(points[i][0], points[i][1]);
    const [sx2, sy2] = childToScreen(points[i + 1][0], points[i + 1][1]);
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.fillStyle = colors.accent;
  for (let i = 0; i < points.length - 1; i++) {
    const [sx1, sy1] = childToScreen(points[i][0], points[i][1]);
    const [sx2, sy2] = childToScreen(points[i + 1][0], points[i + 1][1]);
    const mx = (sx1 + sx2) / 2;
    const my = (sy1 + sy2) / 2;
    const angle = Math.atan2(sy2 - sy1, sx2 - sx1);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-6, -5);
    ctx.lineTo(7, 0);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // draw every pin first, so label placement can treat all of them as
  // obstacles regardless of draw order
  const pinLabelFont = `700 13px ${CARD_FONT}`;
  const screenPositions = entry.stops.map((stop, idx) => {
    const [sx, sy] = childToScreen(points[idx][0], points[idx][1]);
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.bg;
    ctx.stroke();
    return { sx, sy, text: stop.word, idx };
  });
  const placedLabels = placeCardLabels(ctx, screenPositions, pinLabelFont);
  placedLabels.forEach((label) => {
    if (label.hidden) {
      // no collision-free spot for the word itself - fall back to just
      // the stage number, still cross-referenceable against the list
      ctx.beginPath();
      ctx.arc(label.sx, label.sy, 8, 0, Math.PI * 2);
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colors.accent;
      ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.font = `700 10px ${CARD_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(label.idx + 1), label.sx, label.sy + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      return;
    }
    ctx.font = pinLabelFont;
    ctx.textAlign = label.align === "right" ? "right" : "left";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.bg;
    ctx.strokeText(label.text, label.x, label.y);
    ctx.fillStyle = colors.text;
    ctx.fillText(label.text, label.x, label.y);
    ctx.textAlign = "left";
  });

  // site link + brand mark sit together in the card's actual bottom-right
  // corner, under the map, on the same baseline as the tagline at
  // bottom-left
  ctx.textBaseline = "alphabetic";
  const linkBaseline = CARD_HEIGHT - 22;
  const linkFont = `700 15px ${CARD_FONT}`;
  ctx.font = linkFont;
  const linkText = "ETYMOLOGYMAP.COM";
  const linkW = ctx.measureText(linkText).width;
  const iconSize = 16;
  const iconGap = 8;
  const groupRight = CARD_WIDTH - padding;
  const textX = groupRight - linkW;
  const iconX = textX - iconGap - iconSize;
  const iconY = linkBaseline - iconSize + 3;

  ctx.fillStyle = colors.accent;
  ctx.font = linkFont;
  ctx.fillText(linkText, textX, linkBaseline);

  if (favicon) {
    ctx.drawImage(favicon, iconX, iconY, iconSize, iconSize);
    ctx.save();
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(iconX - 0.5, iconY - 0.5, iconSize + 1, iconSize + 1);
    ctx.restore();
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function updateShareThemeButtons() {
  shareThemeLightBtn.classList.toggle("active", shareCardTheme === "light");
  shareThemeLightBtn.setAttribute("aria-pressed", shareCardTheme === "light" ? "true" : "false");
  shareThemeDarkBtn.classList.toggle("active", shareCardTheme === "dark");
  shareThemeDarkBtn.setAttribute("aria-pressed", shareCardTheme === "dark" ? "true" : "false");
}

async function generateShareCard() {
  shareStatusEl.hidden = true;
  shareStatusEl.textContent = "";
  shareDownloadBtn.disabled = true;
  shareCopyBtn.disabled = true;
  shareNativeBtn.disabled = true;

  const blob = await buildShareCard(lastWord, lastEntry, lastPoints, getCardColors(shareCardTheme));
  currentShareBlob = blob;
  if (!blob) {
    shareStatusEl.hidden = false;
    shareStatusEl.textContent = "Couldn't render the image in this browser.";
    return;
  }

  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = URL.createObjectURL(blob);
  sharePreview.src = currentPreviewUrl;

  shareDownloadBtn.disabled = false;
  shareCopyBtn.disabled = !(navigator.clipboard && window.ClipboardItem);

  const shareFile = new File([blob], `${lastWord}-etymology.png`, { type: "image/png" });
  shareNativeBtn.disabled = !(navigator.canShare && navigator.canShare({ files: [shareFile] }));
}

async function openShareModal() {
  if (!lastWord || !lastEntry || !lastPoints) return;
  if (window.emTrack) window.emTrack.share(lastWord);

  shareCardTheme = isDarkActive() ? "dark" : "light";
  updateShareThemeButtons();

  shareStatusEl.hidden = true;
  shareStatusEl.textContent = "";
  shareDownloadBtn.disabled = true;
  shareCopyBtn.disabled = true;
  shareNativeBtn.disabled = true;
  sharePreview.removeAttribute("src");
  shareModal.hidden = false;

  await generateShareCard();
}

function closeShareModal() {
  shareModal.hidden = true;
}

function setupShareCard() {
  shareBtn.addEventListener("click", openShareModal);
  const shareBtnGlobe = document.getElementById("share-btn-globe");
  if (shareBtnGlobe) shareBtnGlobe.addEventListener("click", openShareModal);
  shareCloseBtn.addEventListener("click", closeShareModal);
  shareModal.addEventListener("click", (e) => {
    if (e.target === shareModal) closeShareModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !shareModal.hidden) closeShareModal();
  });

  shareThemeLightBtn.addEventListener("click", () => {
    if (shareCardTheme === "light") return;
    shareCardTheme = "light";
    updateShareThemeButtons();
    generateShareCard();
  });
  shareThemeDarkBtn.addEventListener("click", () => {
    if (shareCardTheme === "dark") return;
    shareCardTheme = "dark";
    updateShareThemeButtons();
    generateShareCard();
  });

  shareDownloadBtn.addEventListener("click", () => {
    if (!currentShareBlob || !lastWord) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(currentShareBlob);
    a.download = `${lastWord}-etymology.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  shareCopyBtn.addEventListener("click", async () => {
    if (!currentShareBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": currentShareBlob })]);
      shareStatusEl.hidden = false;
      shareStatusEl.textContent = "Copied to clipboard.";
    } catch (err) {
      shareStatusEl.hidden = false;
      shareStatusEl.textContent = "Couldn't copy the image in this browser.";
    }
  });

  shareNativeBtn.addEventListener("click", async () => {
    if (!currentShareBlob || !lastWord || !lastEntry) return;
    const file = new File([currentShareBlob], `${lastWord}-etymology.png`, { type: "image/png" });
    try {
      await navigator.share({
        files: [file],
        title: `${lastWord} | Etymology Map`,
        // Web Share API support for combining files with a separate url
        // field is inconsistent across browsers, so the link travels as
        // plain text instead - that works everywhere the text field does.
        text: `Check out the journey "${lastWord}" took into English! See more at ${window.location.href}`,
      });
    } catch (err) {
      if (err && err.name !== "AbortError") {
        shareStatusEl.hidden = false;
        shareStatusEl.textContent = "Sharing isn't available right now.";
      }
    }
  });
}

// --- Dark mode ------------------------------------------------------------
// Defaults to the OS preference (handled purely in CSS via
// prefers-color-scheme); an explicit toggle stamps data-theme on <html>,
// which the CSS overrides in either direction, and remembers the choice.

const THEME_STORAGE_KEY = "etymology-map-theme";
const themeToggleBtn = document.getElementById("theme-toggle-btn");

function isDarkActive() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const dark = isDarkActive();
  themeToggleBtn.innerHTML = icon(dark ? "sun" : "moon", 18);
  themeToggleBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

// The page follows the system setting until the toggle is used; after
// that the saved choice wins. The icon also follows the system when it
// changes while no choice is saved.
function setupThemeToggle() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch (err) {
    stored = null;
  }
  applyTheme(stored);

  themeToggleBtn.addEventListener("click", () => {
    const next = isDarkActive() ? "light" : "dark";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (err) {
      // Private browsing or storage disabled; theme just won't persist.
    }
    applyTheme(next);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.getAttribute("data-theme")) applyTheme(null);
  });
}

function setupCopyLink() {
  [copyLinkBtn, copyLinkBtnGlobe].forEach((btn) => {
    if (!btn) return;
    let resetTimer = null;
    let original = null;
    btn.addEventListener("click", async () => {
      if (original === null) original = btn.innerHTML;
      const iconOnly = btn.classList.contains("icon-btn");
      try {
        await navigator.clipboard.writeText(window.location.href);
        btn.innerHTML = iconOnly ? icon("check", 16) : "Copied";
        btn.classList.add("copied");
      } catch (err) {
        btn.innerHTML = iconOnly ? icon("triangle-alert", 16) : "Couldn't copy";
      }
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        btn.innerHTML = original;
        btn.classList.remove("copied");
      }, 1500);
    });
  });
}

// Icon-only search button inside the box and the phone's arrow button
// both trace, like pressing Enter.
traceIconBtn.addEventListener("click", () => trace());

hydrateIcons();
setupPanZoom();
setupShareCard();
setupThemeToggle();
setupWordList();
setupOriginSearch();
setupSurprise();
setupCopyLink();
setupAutocomplete();
setupHomeLink();
setupWod();
setupViewToggle();

if (window.ResizeObserver) new ResizeObserver(() => updatePinPositions()).observe(mapSvg);

(async function init() {
  await Promise.all([loadWordIndex(), loadMap()]);
  if (Object.keys(wordIndex).length === 0) {
    showLoadError(() => window.location.reload());
    return;
  }
  renderExampleChips();
  setMapView(currentView, { save: false });
  syncGlobeVariant();
  await pickDailyWod();
  initFromUrl();
})();
