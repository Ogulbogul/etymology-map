const MAP_WIDTH = 960;
const MAP_HEIGHT = 500;
const MIN_ZOOM = 1;
const MAX_ZOOM = 14;
const FIT_PADDING = 60;

const homeLink = document.getElementById("home-link");
const emptyChipsBar = document.getElementById("empty-chips-bar");
const wordInput = document.getElementById("word-input");
const traceBtn = document.getElementById("trace-btn");
const hintEl = document.getElementById("hint");
const messageEl = document.getElementById("message");
const resultEl = document.getElementById("result");
const panelEl = document.getElementById("panel");
const resultHeaderEl = document.getElementById("result-header");
const resultWordTextEl = document.getElementById("result-word-text");
const resultTrailEl = document.getElementById("result-trail");
const mapSvg = document.getElementById("map");
const mapCanvasEl = document.querySelector(".map-canvas");
const zoomLayer = document.getElementById("zoom-layer");
const landLayer = document.getElementById("land-layer");
const pathLayer = document.getElementById("path-layer");
const arrowLayer = document.getElementById("arrow-layer");
const pinLayer = document.getElementById("pin-layer");
const badgeEl = document.getElementById("current-meaning-badge");
const badgeTextEl = document.getElementById("badge-text");
const originSentenceEl = document.getElementById("origin-sentence");
const fullStoryEl = document.getElementById("full-story");
const fullStoryTextEl = document.getElementById("full-story-text");
const relatedWordsEl = document.getElementById("related-words");
const relatedWordsLangEl = document.getElementById("related-words-lang");
const relatedWordsGridEl = document.getElementById("related-words-grid");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const wordlistToggleBtn = document.getElementById("wordlist-toggle-btn");
const wordlistPanel = document.getElementById("wordlist-panel");
const wordlistGrid = document.getElementById("wordlist-grid");
const wordlistOriginSelect = document.getElementById("wordlist-origin-select");
const wordlistCountEl = document.getElementById("wordlist-count");
const surpriseBtn = document.getElementById("surprise-btn");
const copyLinkBtn = document.getElementById("copy-link-btn");
const inputWrap = document.querySelector(".input-wrap");
const autocompleteList = document.getElementById("autocomplete-list");
const originSearchInput = document.getElementById("wordlist-origin-search");
const originSearchWrap = document.querySelector(".origin-search-wrap");
const originAutocompleteList = document.getElementById("origin-autocomplete-list");

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
async function fetchWordEntry(word) {
  try {
    const res = await fetch(`data/words/${encodeURIComponent(word)}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`Could not load data/words/${word}.json`, err);
    return null;
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
  allOrigins = [...counts.keys()].sort((a, b) => a.localeCompare(b));

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
}

function closeWordList() {
  wordlistPanel.hidden = true;
  wordlistToggleBtn.setAttribute("aria-expanded", "false");
}

function setupWordList() {
  wordlistToggleBtn.addEventListener("click", () => {
    if (wordlistPanel.hidden) openWordList();
    else closeWordList();
  });
  wordlistOriginSelect.addEventListener("change", () => {
    originSearchInput.value = wordlistOriginSelect.value;
    renderWordList(wordlistOriginSelect.value);
  });
}

// --- Origin search (for the long origin list) ---------------------------
// Same prefix/substring-match dropdown pattern as the word autocomplete,
// but selecting an entry sets the origin filter instead of tracing a word.

let originAcMatches = [];
let originAcActiveIndex = -1;

function getOriginMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
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
  wordInput.focus();
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
  const count = window.innerWidth < 600 ? 2 : 6;
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
  } catch (err) {
    console.warn("Falling back to manual projection; world map coastlines unavailable.", err);
    projectPoint = manualProject;
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

function showNotFound(displayWord, raw) {
  messageEl.innerHTML = "";
  messageEl.appendChild(document.createTextNode(`"${displayWord}" isn't in this collection yet.`));

  const suggestions = findSuggestions(raw);
  if (suggestions.length > 0) {
    const wrap = document.createElement("span");
    wrap.className = "message-suggestions";
    wrap.appendChild(document.createTextNode(" Did you mean "));
    suggestions.forEach((s, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestion-link";
      btn.textContent = s;
      btn.addEventListener("click", () => {
        wordInput.value = s;
        trace();
      });
      wrap.appendChild(btn);
      if (i < suggestions.length - 1) {
        wrap.appendChild(document.createTextNode(i === suggestions.length - 2 ? ", or " : ", "));
      }
    });
    wrap.appendChild(document.createTextNode("?"));
    messageEl.appendChild(wrap);
  }
  messageEl.hidden = false;
}

function clearResult() {
  resultEl.classList.add("is-empty");
  resultHeaderEl.hidden = true;
  panelEl.innerHTML = "";
  resultTrailEl.innerHTML = "";
  pathLayer.innerHTML = "";
  arrowLayer.innerHTML = "";
  pinLayer.innerHTML = "";
  badgeEl.hidden = true;
  originSentenceEl.hidden = true;
  originSentenceEl.innerHTML = "";
  fullStoryEl.hidden = true;
  fullStoryEl.open = false;
  fullStoryTextEl.innerHTML = "";
  relatedWordsEl.hidden = true;
  relatedWordsGridEl.innerHTML = "";
  setView({ x: 0, y: 0, k: 1 });
  renderExampleChips();
}

function setActive(index, isActive) {
  const row = panelEl.querySelector(`.stop-row[data-idx="${index}"]`);
  const pin = pinLayer.querySelector(`.pin-group[data-idx="${index}"]`);
  const trailItem = resultTrailEl.querySelector(`.trail-item[data-idx="${index}"]`);
  [row, pin, trailItem].forEach((el) => el && el.classList.toggle("active", isActive));
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

function updatePinPositions() {
  pinLayer.querySelectorAll(".pin-group").forEach((g) => {
    const cx = parseFloat(g.dataset.cx);
    const cy = parseFloat(g.dataset.cy);
    const sx = view.k * cx + view.x;
    const sy = view.k * cy + view.y;
    const circle = g.querySelector(".pin-dot");
    const label = g.querySelector(".pin-label");
    circle.setAttribute("cx", sx);
    circle.setAttribute("cy", sy);
    label.setAttribute("x", sx + 13);
    label.setAttribute("y", sy - 11);
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

function computeFitView(points) {
  if (points.length === 0) return { x: 0, y: 0, k: 1 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(([px, py]) => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  });
  const bboxW = Math.max(maxX - minX, 1);
  const bboxH = Math.max(maxY - minY, 1);
  const k = clamp(
    Math.min((MAP_WIDTH - 2 * FIT_PADDING) / bboxW, (MAP_HEIGHT - 2 * FIT_PADDING) / bboxH),
    MIN_ZOOM,
    MAX_ZOOM
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: MAP_WIDTH / 2 - k * cx, y: MAP_HEIGHT / 2 - k * cy, k };
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
    middleHtml = "adopted directly into English";
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

function renderWord(word, entry) {
  clearResult();
  clearMessage();
  resultEl.classList.remove("is-empty");
  resultHeaderEl.hidden = false;
  resultWordTextEl.textContent = word;
  const wordSlug = slugify(word);

  entry.stops.forEach((stop, idx) => {
    const row = document.createElement("a");
    row.className = "stop-row";
    row.href = `/words/${wordSlug}?stop=${idx + 1}`;
    row.target = "_blank";
    row.rel = "noopener";
    row.title = `Open ${stop.word}'s page`;
    row.dataset.idx = String(idx);
    row.innerHTML = `
      <div class="stop-marker">
        <div class="stop-circle">${idx + 1}</div>
        <div class="stop-connector"></div>
      </div>
      <div class="stop-card">
        <div class="stop-order">Stage ${idx + 1} of ${entry.stops.length}</div>
        <div class="stop-word">${escapeHtml(stop.word)}</div>
        <div class="stop-lang-era">${escapeHtml(stop.lang)} &middot; ${escapeHtml(stop.era)}</div>
        <div class="stop-meaning">"${escapeHtml(stop.meaning)}"</div>
        <div class="stop-note">${escapeHtml(stop.note)}</div>
      </div>
    `;
    row.addEventListener("mouseenter", () => setActive(idx, true));
    row.addEventListener("mouseleave", () => setActive(idx, false));
    panelEl.appendChild(row);
  });

  entry.stops.forEach((stop, idx) => {
    if (idx > 0) {
      const arrow = document.createElement("span");
      arrow.className = "trail-arrow";
      arrow.textContent = "→";
      resultTrailEl.appendChild(arrow);
    }
    const item = document.createElement("a");
    item.className = "trail-item";
    item.href = `/words/${wordSlug}?stop=${idx + 1}`;
    item.target = "_blank";
    item.rel = "noopener";
    item.title = `Open ${stop.word}'s page`;
    item.dataset.idx = String(idx);
    item.textContent = stop.word;
    item.addEventListener("mouseenter", () => setActive(idx, true));
    item.addEventListener("mouseleave", () => setActive(idx, false));
    resultTrailEl.appendChild(item);
  });

  const points = entry.stops.map((s) => projectPoint(s.lon, s.lat));
  lastWord = word;
  lastEntry = entry;
  lastPoints = points;

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

    // Arrowhead at the segment midpoint (not the endpoint) so it's clearly
    // visible in open space instead of being crowded next to the pin.
    // The transform is a similarity (translate + uniform scale), so an
    // angle computed from the raw child coordinates is valid on screen too.
    const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    arrow.setAttribute("class", "route-arrow");
    arrow.setAttribute("d", "M -7,-7 L 8,0 L -7,7");
    arrow.dataset.cx = String((x1 + x2) / 2);
    arrow.dataset.cy = String((y1 + y2) / 2);
    arrow.dataset.angle = String(angleDeg);
    arrowLayer.appendChild(arrow);
  }

  entry.stops.forEach((stop, idx) => {
    const [x, y] = points[idx];
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "pin-group");
    g.dataset.idx = String(idx);
    g.dataset.cx = String(x);
    g.dataset.cy = String(y);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", 8.5);
    circle.setAttribute("class", "pin-dot");

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "pin-label");
    label.textContent = stop.word;

    g.appendChild(circle);
    g.appendChild(label);
    g.addEventListener("mouseenter", () => setActive(idx, true));
    g.addEventListener("mouseleave", () => setActive(idx, false));
    pinLayer.appendChild(g);
  });

  setView({ x: 0, y: 0, k: 1 });
  animateViewTo(computeFitView(points));

  badgeEl.hidden = false;
  badgeTextEl.textContent = entry.current_meaning;

  originSentenceEl.innerHTML = buildOriginSentence(word, entry.stops);
  originSentenceEl.hidden = false;
  fullStoryTextEl.innerHTML = buildNarrative(word, entry.stops, entry.current_meaning);
  fullStoryEl.hidden = false;

  renderRelatedWords(word, entry.stops[0].lang);
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
  const displayWord = wordInput.value.trim();
  const raw = displayWord.toLowerCase();
  if (!raw) return;
  updateUrlForWord(raw, !!options.fromUrl);
  const entry = await fetchWordEntry(raw);
  if (!entry) {
    clearResult();
    showNotFound(displayWord, raw);
    return;
  }
  renderWord(raw, entry);
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
function computeCropRect(points, panelW, panelH, padding = 55) {
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

function buildShareCard(word, entry, points, colors) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const padding = 48;
  const leftW = 400;
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

  let y = padding + 76;
  const displayWord = word.charAt(0).toUpperCase() + word.slice(1);
  const titleSize = fitCanvasFontSize(ctx, displayWord, leftW, 68, 40, "700");
  ctx.fillStyle = colors.text;
  ctx.font = `700 ${titleSize}px ${CARD_FONT}`;
  ctx.fillText(displayWord, padding, y);

  y += 42;
  ctx.fillStyle = colors.accent;
  ctx.font = `700 12px ${CARD_FONT}`;
  ctx.fillText("TODAY IT MEANS", padding, y);

  y += 24;
  ctx.fillStyle = colors.text;
  ctx.font = `400 18px ${CARD_FONT}`;
  const meaningLines = wrapCanvasText(ctx, entry.current_meaning, leftW).slice(0, 3);
  meaningLines.forEach((line) => {
    ctx.fillText(line, padding, y);
    y += 24;
  });

  y += 22;
  const rowsRemaining = CARD_HEIGHT - padding - 30 - y;
  const rowGap = Math.max(34, Math.min(50, rowsRemaining / entry.stops.length));
  entry.stops.forEach((stop, idx) => {
    const rowY = y + idx * rowGap;

    ctx.beginPath();
    ctx.arc(padding + 10, rowY - 6, 10, 0, Math.PI * 2);
    ctx.fillStyle = colors.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.accent;
    ctx.stroke();
    ctx.fillStyle = colors.accent;
    ctx.font = `700 11px ${CARD_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(String(idx + 1), padding + 10, rowY - 2);
    ctx.textAlign = "left";

    ctx.fillStyle = colors.text;
    ctx.font = `700 17px ${CARD_FONT}`;
    ctx.fillText(stop.word, padding + 32, rowY);
    const wordWidth = ctx.measureText(stop.word).width;
    ctx.fillStyle = colors.dim;
    ctx.font = `400 13px ${CARD_FONT}`;
    ctx.fillText(`  ·  ${stop.lang}`, padding + 32 + wordWidth, rowY);
  });

  ctx.fillStyle = colors.dim;
  ctx.font = `400 12px ${CARD_FONT}`;
  ctx.fillText("Made with Etymology Map", padding, CARD_HEIGHT - 22);

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

  entry.stops.forEach((stop, idx) => {
    const [sx, sy] = childToScreen(points[idx][0], points[idx][1]);
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.bg;
    ctx.stroke();

    ctx.font = `700 13px ${CARD_FONT}`;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.bg;
    ctx.strokeText(stop.word, sx + 10, sy - 8);
    ctx.fillStyle = colors.text;
    ctx.fillText(stop.word, sx + 10, sy - 8);
  });

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
        text: `The word "${lastWord}" traveled through ${lastEntry.stops.length} languages. Today it means: ${lastEntry.current_meaning}`,
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
  themeToggleBtn.textContent = dark ? "☀️" : "🌙";
  themeToggleBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

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
}

function setupCopyLink() {
  let resetTimer = null;
  copyLinkBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyLinkBtn.textContent = "✓";
      copyLinkBtn.classList.add("copied");
    } catch (err) {
      copyLinkBtn.textContent = "⚠️";
    }
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copyLinkBtn.textContent = "🔗";
      copyLinkBtn.classList.remove("copied");
    }, 1500);
  });
}

setupPanZoom();
setupShareCard();
setupThemeToggle();
setupWordList();
setupOriginSearch();
setupSurprise();
setupCopyLink();
setupAutocomplete();
setupHomeLink();

(async function init() {
  await Promise.all([loadWordIndex(), loadMap()]);
  renderExampleChips();
  initFromUrl();
})();
