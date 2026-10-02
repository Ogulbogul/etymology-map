// Private stats page for the anonymous usage totals.
// Open /api/stats?key=YOUR_STATS_KEY (optionally &days=7, max 400).
// STATS_KEY is a secret set in the Cloudflare Pages project settings.
//
// Everything is inline (no external scripts, fonts or images): charts are
// drawn as SVG by a small script from the totals embedded in the page.
// Lists are server-rendered and escaped; the script only ever uses
// textContent, never innerHTML, so nothing from the database can inject markup.

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const fmtNum = (n) => Number(n || 0).toLocaleString("en-US");
const fmtSecs = (s) => {
  s = Math.round(s || 0);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Change vs. the previous period, as text plus a good/bad/flat class. `invert`
// flips the colouring for metrics where more is worse (404s).
function delta(cur, prev, invert) {
  if (!prev && !cur) return { text: "no change", cls: "flat" };
  if (!prev) return { text: "new", cls: invert ? "bad" : "good" };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { text: "0%", cls: "flat" };
  const up = pct > 0;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(pct)}%`, cls: up !== !!invert ? "good" : "bad" };
}

async function loadWordSet(env, request) {
  try {
    const res = await env.ASSETS.fetch(new URL("/data/words-index.json", request.url));
    if (!res.ok) return null;
    return new Set(Object.keys(await res.json()));
  } catch (err) {
    return null;
  }
}

// One ranked list rendered as bars. Shows the top TOP rows; the rest are
// tucked behind a toggle and, once open, scroll inside the card so a long list
// can never push the other sections out of view.
const TOP = 7;
const FOLD = '<button class="fold" type="button" aria-expanded="true" aria-label="Collapse section" title="Collapse"></button>';
function rankCard({ id, title, note, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.bar));
  const items = rows
    .map((r, i) => {
      const pct = Math.max(2, Math.round((r.bar / max) * 100));
      return (
        `<li${i >= TOP ? ' class="extra"' : ""} data-t="${esc(r.label.toLowerCase())}">` +
        `<span class="fill" style="width:${pct}%"></span>` +
        `<span class="lbl">${esc(r.label)}</span>` +
        (r.sub ? `<span class="sub">${esc(r.sub)}</span>` : "") +
        `<span class="val">${esc(r.value)}</span></li>`
      );
    })
    .join("");
  const controls =
    rows.length > TOP
      ? `<div class="tools"><input class="filter" type="search" placeholder="Filter ${rows.length} items" aria-label="Filter ${esc(title)}">` +
        `<button class="more" type="button" data-label="Show all ${rows.length}">Show all ${rows.length}</button></div>`
      : "";
  return (
    `<section class="card" id="${id}">` +
    `<header><h2>${esc(title)}</h2><span class="hr"><span class="badge">${fmtNum(rows.length)}</span>${FOLD}</span></header>` +
    (note ? `<p class="note">${esc(note)}</p>` : "") +
    (rows.length ? `<ol class="list">${items}</ol>${controls}` : `<p class="empty">No data yet</p>`) +
    `</section>`
  );
}

const CSS = `
:root{--bg:#fafaf8;--panel:#fff;--border:#e3e1db;--text:#2a2a28;--dim:#6b6a64;--accent:#b3541e;--accent-soft:#f3e3d3;--bar:#f3e3d3;--good:#2e7d4f;--bad:#b3261e;--r:16px;--logo:#e2934f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#17140f;--panel:#211d17;--border:#3a352c;--text:#f1ece2;--dim:#a89e8c;--accent:#e2934f;--accent-soft:rgba(226,147,79,.18);--bar:rgba(226,147,79,.2);--good:#6fcf97;--bad:#ff8a80;color-scheme:dark}}
:root[data-theme="light"]{--bg:#fafaf8;--panel:#fff;--border:#e3e1db;--text:#2a2a28;--dim:#6b6a64;--accent:#b3541e;--accent-soft:#f3e3d3;--bar:#f3e3d3;--good:#2e7d4f;--bad:#b3261e;--r:16px;--logo:#e2934f;color-scheme:light}
:root[data-theme="dark"]{--bg:#17140f;--panel:#211d17;--border:#3a352c;--text:#f1ece2;--dim:#a89e8c;--accent:#e2934f;--accent-soft:rgba(226,147,79,.18);--bar:rgba(226,147,79,.2);--good:#6fcf97;--bad:#ff8a80;--r:16px;--logo:#e2934f;color-scheme:dark}
:root[data-theme="midnight"]{--bg:#0b1220;--panel:#121b2e;--border:#25324d;--text:#e6ecf7;--dim:#94a3c0;--accent:#5eb8ff;--accent-soft:rgba(94,184,255,.16);--bar:rgba(94,184,255,.2);--good:#6fe3a0;--bad:#ff8b8b;--r:12px;--logo:#5eb8ff;color-scheme:dark}
:root[data-theme="forest"]{--bg:#0e1912;--panel:#15241a;--border:#28402f;--text:#e7f0e9;--dim:#9db5a4;--accent:#86d98f;--accent-soft:rgba(134,217,143,.16);--bar:rgba(134,217,143,.2);--good:#9be7a3;--bad:#ff9a8a;--r:20px;--logo:#86d98f;color-scheme:dark}
:root[data-theme="mono"]{--bg:#f4f4f4;--panel:#fff;--border:#d0d0d0;--text:#111;--dim:#666;--accent:#111;--accent-soft:#e4e4e4;--bar:#e9e9e9;--good:#222;--bad:#777;--r:4px;--logo:#fff;color-scheme:light}
:root[data-theme="ink"]{--bg:#000;--panel:#0d0d0d;--border:#2c2c2c;--text:#f2f2f2;--dim:#9a9a9a;--accent:#fff;--accent-soft:rgba(255,255,255,.14);--bar:rgba(255,255,255,.16);--good:#e6e6e6;--bad:#8c8c8c;--r:4px;--logo:#fff;color-scheme:dark}
:root[data-theme="mono"] .logo,:root[data-theme="ink"] .logo{background:#000;border:1px solid var(--border)}
:root[data-theme="paper"]{--bg:#f3f3f1;--panel:#fff;--border:#d9d9d4;--text:#17171a;--dim:#5f5f68;--accent:#4a43d8;--accent-soft:#e3e2fb;--bar:#e3e2fb;--good:#137a3e;--bad:#b3261e;--r:6px;--logo:#a9a5ff;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:2400px;margin:0 auto;padding:24px 20px 60px}
@media (min-width:1100px){.wrap{padding:22px 32px 48px}}
.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:30px;height:30px;border-radius:7px;background:#17140f;display:flex;align-items:center;justify-content:center}
.logo path{stroke:var(--logo)}
.controls{display:flex;align-items:center;flex-wrap:wrap;gap:14px}
.themes{display:flex;align-items:center;gap:8px}
.tname{font-size:12px;color:var(--dim);width:96px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw{all:unset;box-sizing:border-box;width:22px;height:22px;border-radius:50%;border:1px solid var(--border);cursor:pointer}
.sw:hover{transform:scale(1.12)}
.sw[aria-pressed=true]{outline:2px solid var(--accent);outline-offset:2px}
.sw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
h1{margin:0;font-size:20px;letter-spacing:-.01em}
.sub-h{color:var(--dim);font-size:13px;margin:2px 0 0}
.range{display:inline-flex;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--panel)}
.range a{padding:7px 14px;font-size:13px;font-weight:700;color:var(--dim);text-decoration:none;border-right:1px solid var(--border)}
.range a:last-child{border-right:0}
.range a:hover{color:var(--text)}
.range a.on{background:var(--accent);color:var(--bg)}
.jump{position:sticky;top:0;z-index:5;margin:18px -20px 0;padding:10px 20px;background:var(--bg);border-bottom:1px solid var(--border);display:flex;gap:8px;overflow-x:auto}
.jump a{flex:none;padding:6px 13px;border:1px solid var(--border);border-radius:999px;font-size:13px;font-weight:600;color:var(--text);text-decoration:none;background:var(--panel)}
.jump a:hover{border-color:var(--accent);color:var(--accent)}
section{scroll-margin-top:64px}
.fblist{list-style:none;margin:0;padding:0;display:grid;gap:10px}.fblist li{padding:10px 12px;border:1px solid var(--border);border-radius:10px;white-space:pre-wrap;word-break:break-word}.fblist small{display:block;margin-top:4px;color:var(--dim);white-space:normal}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:20px}
@media (min-width:1100px){.kpis{grid-template-columns:repeat(7,1fr);margin-top:12px}}
.kpi{all:unset;box-sizing:border-box;cursor:pointer;background:var(--panel);border:1px solid var(--border);border-radius:calc(var(--r) - 2px);padding:10px 14px 8px;display:flex;flex-direction:column;gap:1px}
.kpi:hover{border-color:var(--accent)}
.kpi:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.kpi[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.kpi .k{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}
.kpi .v{font-size:28px;font-weight:800;letter-spacing:-.02em;line-height:1.15}
.kpi .d{font-size:12px;font-weight:700}
.d.good{color:var(--good)}.d.bad{color:var(--bad)}.d.flat{color:var(--dim)}
.spark{height:28px;margin-top:auto;padding-top:6px}.spark svg{width:100%;height:100%;display:block}
.spark polyline{fill:none;stroke:var(--accent);stroke-width:1.75;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.spark polygon{fill:var(--accent-soft)}
.panel{display:flex;flex-direction:column;min-width:0;background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:16px 16px 12px}
.panel h2{margin:0;font-size:16px}
.panel .cap{color:var(--dim);font-size:13px;margin:2px 0 8px}
.chartwrap{position:relative;flex:1;min-height:260px}
#chart{position:absolute;inset:0}
#chart svg{width:100%;height:100%;display:block;touch-action:pan-y}
.grid-l{stroke:var(--border);stroke-width:1}
.axis{fill:var(--dim);font-size:11px}
.bar{fill:var(--accent);opacity:.85}
.area{fill:var(--accent-soft)}
.line{fill:none;stroke:var(--accent);stroke-width:2.25;stroke-linejoin:round}
.guide{stroke:var(--dim);stroke-width:1;stroke-dasharray:3 3}
.dot{fill:var(--accent);stroke:var(--panel);stroke-width:2}
#tip{position:absolute;pointer-events:none;background:var(--text);color:var(--bg);border-radius:8px;padding:5px 10px;font-size:12px;white-space:nowrap;transform:translate(-50%,-100%);display:none}
#tip b{display:block;font-size:14px}
.main{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}
@media (min-width:860px){.main{grid-template-columns:1fr 1fr}.panel{grid-column:1/-1}}
@media (min-width:1100px){.main{grid-template-columns:repeat(3,1fr)}}
@media (min-width:1600px){.main{grid-template-columns:repeat(4,1fr)}.panel{grid-column:span 2}.jump{display:none}}
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:16px 16px 12px;min-width:0}
.card header,.panel header{display:flex;align-items:center;justify-content:space-between;gap:10px}
.hr{display:flex;align-items:center;gap:8px}
.fold{all:unset;box-sizing:border-box;width:24px;height:24px;border:1px solid var(--border);border-radius:7px;cursor:pointer;position:relative;flex:none}
.fold::after{content:"";position:absolute;left:8px;top:6px;width:6px;height:6px;border-right:2px solid var(--dim);border-bottom:2px solid var(--dim);transform:rotate(45deg);transition:transform .15s}
.fold:hover{border-color:var(--accent)}.fold:hover::after{border-color:var(--accent)}
.fold:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.fold[aria-expanded=false]::after{transform:rotate(-135deg);top:9px}
.collapsed{align-self:start}
.collapsed>*:not(header){display:none!important}
.daypick{font:inherit;font-size:13px;font-weight:600;padding:7px 10px;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:var(--text);cursor:pointer}
.bar.dim{opacity:.28}
.card h2{margin:0;font-size:16px}
.badge{font-size:12px;font-weight:700;color:var(--dim);border:1px solid var(--border);border-radius:999px;padding:1px 9px}
.note{color:var(--dim);font-size:13px;margin:3px 0 4px}
.list{list-style:none;margin:8px 0 0;padding:0;counter-reset:r}
.list li{position:relative;display:flex;align-items:center;gap:8px;padding:5px 10px 5px 34px;border-radius:8px;overflow:hidden;counter-increment:r;font-size:13.5px}
.list li::before{content:counter(r);position:absolute;left:10px;width:18px;text-align:right;font-size:11px;color:var(--dim);z-index:1}
.list li+li{margin-top:2px}
.fill{position:absolute;inset:0 auto 0 0;background:var(--bar);border-radius:8px}
.lbl{position:relative;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub{position:relative;color:var(--dim);font-size:12px;white-space:nowrap}
.val{position:relative;font-weight:700;font-variant-numeric:tabular-nums}
.card:not(.open) .list li.extra{display:none}
.list li[hidden]{display:none!important}
.card.open .list{max-height:430px;overflow:auto;padding-right:4px}
.tools{display:flex;gap:8px;margin-top:10px}
.filter{flex:1;min-width:0;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font:inherit;font-size:13px}
.more{padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--accent);font:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
.more:hover{border-color:var(--accent)}
.empty{color:var(--dim);font-size:14px;margin:12px 0 4px}
.foot{margin-top:26px;color:var(--dim);font-size:12px;text-align:center}
@media (min-width:1600px) and (min-height:720px){
.wrap{height:100vh;height:100dvh;display:flex;flex-direction:column;padding-bottom:14px}
.main{flex:1;min-height:0;grid-template-rows:repeat(2,minmax(0,1fr))}
.card,.panel{min-height:0;overflow:hidden}
.card{display:flex;flex-direction:column}
.card .list,.card.open .list{flex:1;min-height:0;max-height:none;overflow:auto;padding-right:4px}
.card:not(.open) .list li.extra{display:flex}
.more{display:none}
.foot{margin-top:10px}
}
`;

const CLIENT_JS = String.raw`
(function () {
  var D = JSON.parse(document.getElementById("sdata").textContent);
  var NS = "http://www.w3.org/2000/svg";
  var metric = "view";
  var chart = document.getElementById("chart");
  var tip = document.getElementById("tip");

  function el(n, a) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); return e; }
  function fmtDay(s) {
    var p = s.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  function fmtSecs(s) { s = Math.round(s); return s >= 60 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : s + "s"; }
  function fmtVal(m, v) { return m === "time" ? fmtSecs(v) : Math.round(v).toLocaleString("en-US"); }
  function niceMax(v) {
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  document.querySelectorAll("[data-spark]").forEach(function (box) {
    var vals = D.series[box.getAttribute("data-spark")], n = vals.length, w = 120, h = 30;
    var max = Math.max.apply(null, vals.concat([1]));
    var svg = el("svg", { viewBox: "0 0 " + w + " " + h, preserveAspectRatio: "none", "aria-hidden": "true" });
    var pts = vals.map(function (v, i) {
      var x = n === 1 ? w / 2 : i * (w / (n - 1)), y = h - 2 - (v / max) * (h - 5);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    if (n > 1) {
      svg.appendChild(el("polygon", { points: "0," + h + " " + pts.join(" ") + " " + w + "," + h }));
      svg.appendChild(el("polyline", { points: pts.join(" ") }));
    }
    box.appendChild(svg);
  });

  function draw() {
    chart.textContent = "";
    var vals = D.series[metric], n = vals.length;
    var W = Math.max(280, Math.round(chart.clientWidth)), H = Math.max(170, Math.round(chart.clientHeight)), L = 44, R = 10, T = 10, B = 26, iw = W - L - R, ih = H - T - B;
    var max = niceMax(Math.max.apply(null, vals.concat([1])));
    var bars = n <= 45;
    function yv(v) { return T + ih - (v / max) * ih; }
    function xv(i) { return bars ? L + (i + 0.5) * (iw / n) : (n === 1 ? L + iw / 2 : L + i * (iw / (n - 1))); }
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": D.labels[metric] + " per day" });

    for (var g = 0; g <= 4; g++) {
      var gy = yv(max * g / 4);
      svg.appendChild(el("line", { x1: L, x2: W - R, y1: gy, y2: gy, "class": "grid-l" }));
      var t = el("text", { x: L - 8, y: gy + 4, "text-anchor": "end", "class": "axis" });
      t.textContent = fmtVal(metric, max * g / 4);
      svg.appendChild(t);
    }
    var ticks = Math.min(n, Math.max(3, Math.floor(W / 120))), seen = {};
    for (var k = 0; k < ticks; k++) {
      var idx = ticks === 1 ? 0 : Math.round(k * (n - 1) / (ticks - 1));
      if (seen[idx]) continue;
      seen[idx] = 1;
      var xt = el("text", { x: xv(idx), y: H - 7, "text-anchor": xv(idx) > W - 32 ? "end" : "middle", "class": "axis" });
      xt.textContent = fmtDay(D.days[idx]);
      svg.appendChild(xt);
    }
    if (bars) {
      var bw = Math.max(2, (iw / n) * 0.62);
      vals.forEach(function (v, i) {
        var y = yv(v), hgt = Math.max(v > 0 ? 2 : 0, T + ih - y);
        svg.appendChild(el("rect", { x: xv(i) - bw / 2, y: T + ih - hgt, width: bw, height: hgt, rx: Math.min(3, bw / 2), "class": D.sel >= 0 && i !== D.sel ? "bar dim" : "bar" }));
      });
    } else {
      var pts = vals.map(function (v, i) { return xv(i).toFixed(1) + "," + yv(v).toFixed(1); });
      svg.appendChild(el("polygon", { points: xv(0) + "," + (T + ih) + " " + pts.join(" ") + " " + xv(n - 1) + "," + (T + ih), "class": "area" }));
      svg.appendChild(el("polyline", { points: pts.join(" "), "class": "line" }));
    }
    var guide = el("line", { y1: T, y2: T + ih, "class": "guide", visibility: "hidden" });
    var dot = el("circle", { r: 4.5, "class": "dot", visibility: "hidden" });
    svg.appendChild(guide); svg.appendChild(dot);

    function hide() { guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.style.display = "none"; }
    svg.addEventListener("pointermove", function (e) {
      var r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * W;
      var i = bars ? Math.floor((sx - L) / (iw / n)) : Math.round((sx - L) / (n > 1 ? iw / (n - 1) : 1));
      i = Math.max(0, Math.min(n - 1, i));
      guide.setAttribute("x1", xv(i)); guide.setAttribute("x2", xv(i)); guide.setAttribute("visibility", "visible");
      dot.setAttribute("cx", xv(i)); dot.setAttribute("cy", yv(vals[i])); dot.setAttribute("visibility", bars ? "hidden" : "visible");
      tip.textContent = "";
      var b = document.createElement("b"); b.textContent = fmtVal(metric, vals[i]);
      var s = document.createElement("span"); s.textContent = fmtDay(D.days[i]);
      tip.appendChild(b); tip.appendChild(s);
      tip.style.display = "block";
      tip.style.left = (xv(i) / W * r.width) + "px";
      tip.style.top = (yv(vals[i]) / H * r.height - 8) + "px";
    });
    svg.addEventListener("pointerleave", hide);
    chart.appendChild(svg);
    document.getElementById("chart-title").textContent = D.labels[metric] + " per day";
  }

  document.querySelectorAll(".kpi").forEach(function (b) {
    b.addEventListener("click", function () {
      metric = b.getAttribute("data-m");
      document.querySelectorAll(".kpi").forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
      draw();
    });
  });
  draw();
  var lastW = chart.clientWidth, lastH = chart.clientHeight;
  function redraw() {
    if (chart.clientWidth === lastW && chart.clientHeight === lastH) return;
    lastW = chart.clientWidth; lastH = chart.clientHeight;
    draw();
  }
  if (window.ResizeObserver) new ResizeObserver(redraw).observe(chart);
  else window.addEventListener("resize", redraw);

  var THEMES = ["auto", "light", "dark", "midnight", "forest", "paper", "mono", "ink"], TKEY = "etymology-stats-theme";
  function markTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    var c = t && THEMES.indexOf(t) > -1 ? t : "auto";
    document.querySelectorAll(".sw").forEach(function (b) {
      var on = b.getAttribute("data-theme") === c;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (on) document.getElementById("tname").textContent = b.getAttribute("title");
    });
  }
  document.querySelectorAll(".sw").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = b.getAttribute("data-theme");
      if (t === "auto") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", t);
      try { localStorage.setItem(TKEY, t); } catch (e) {}
      markTheme();
    });
  });
  markTheme();

  var dp = document.getElementById("daypick");
  if (dp) dp.addEventListener("change", function () { window.location.href = dp.value; });

  var FKEY = "etymology-stats-folded", folded = [];
  try { folded = JSON.parse(localStorage.getItem(FKEY) || "[]") || []; } catch (e) { folded = []; }
  function setFold(sec, off) {
    sec.classList.toggle("collapsed", off);
    var b = sec.querySelector("button.fold");
    if (b) { b.setAttribute("aria-expanded", off ? "false" : "true"); b.setAttribute("aria-label", off ? "Expand section" : "Collapse section"); b.title = off ? "Expand" : "Collapse"; }
  }
  document.querySelectorAll("button.fold").forEach(function (b) {
    var sec = b.closest("section");
    if (sec && folded.indexOf(sec.id) > -1) setFold(sec, true);
  });
  document.addEventListener("click", function (e) {
    var f = e.target.closest ? e.target.closest("button.fold") : null;
    if (!f) return;
    var sec = f.closest("section"), off = !sec.classList.contains("collapsed");
    setFold(sec, off);
    folded = folded.filter(function (x) { return x !== sec.id; });
    if (off) folded.push(sec.id);
    try { localStorage.setItem(FKEY, JSON.stringify(folded)); } catch (err) {}
  });

  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button.more") : null;
    if (!b) return;
    var open = b.closest(".card").classList.toggle("open");
    b.textContent = open ? "Show less" : b.getAttribute("data-label");
  });
  document.addEventListener("input", function (e) {
    if (!e.target.classList || !e.target.classList.contains("filter")) return;
    var card = e.target.closest(".card"), q = e.target.value.trim().toLowerCase();
    if (q) card.classList.add("open");
    card.querySelectorAll(".list li").forEach(function (li) { li.hidden = q !== "" && li.getAttribute("data-t").indexOf(q) === -1; });
  });
})();
`;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!env.STATS_KEY || key !== env.STATS_KEY) return new Response("Not found", { status: 404 });
  if (!env.DB) return new Response("The DB binding is not configured.", { status: 500 });

  const today = isoDay(Date.now());
  // ?day=YYYY-MM-DD (one of the last 15 days) narrows every number and list to
  // that single day; the chart then keeps a 15-day window with the day highlighted.
  const dayOpts = Array.from({ length: 15 }, (_, i) => isoDay(Date.now() - i * 86400000));
  const reqDay = url.searchParams.get("day") || "";
  const oneDay = dayOpts.includes(reqDay) ? reqDay : "";
  const days = oneDay ? 1 : Math.min(400, Math.max(1, parseInt(url.searchParams.get("days") || "30", 10) || 30));
  const since = oneDay || isoDay(Date.now() - (days - 1) * 86400000);
  const until = oneDay || today;
  const chartSince = oneDay ? dayOpts[dayOpts.length - 1] : since;
  const prevSince = isoDay(Date.parse(since + "T00:00:00Z") - days * 86400000);
  const q = (sql, ...args) => env.DB.prepare(sql).bind(since, until, ...args).all().then((r) => r.results);

  const [daily, prevTotals, misses, views, stories, shares, times, notFound, gameRows, wordSet, feedbackRows] = await Promise.all([
    env.DB.prepare("SELECT day, type, SUM(count) AS n, SUM(seconds) AS s FROM daily_counts WHERE day >= ?1 AND day <= ?2 GROUP BY day, type")
      .bind(chartSince, today)
      .all()
      .then((r) => r.results),
    env.DB.prepare("SELECT type, SUM(count) AS n, SUM(seconds) AS s FROM daily_counts WHERE day >= ?1 AND day < ?2 GROUP BY type")
      .bind(prevSince, since)
      .all()
      .then((r) => r.results),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND day <= ?2 AND type = 'miss' GROUP BY key ORDER BY n DESC LIMIT 200"),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND day <= ?2 AND type = 'view' GROUP BY key ORDER BY n DESC LIMIT 100"),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND day <= ?2 AND type = 'story' GROUP BY key ORDER BY n DESC LIMIT 50"),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND day <= ?2 AND type = 'share' GROUP BY key ORDER BY n DESC LIMIT 50"),
    q(
      "SELECT v.key AS key, v.n AS views, COALESCE(t.s, 0) AS secs FROM " +
        "(SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND day <= ?2 AND type = 'view' GROUP BY key) v " +
        "LEFT JOIN (SELECT key, SUM(seconds) AS s FROM daily_counts WHERE day >= ?1 AND type = 'time' GROUP BY key) t " +
        "ON t.key = v.key WHERE v.n >= 3 ORDER BY secs * 1.0 / v.n DESC LIMIT 50"
    ),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND day <= ?2 AND type = '404' GROUP BY key ORDER BY n DESC LIMIT 50"),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND day <= ?2 AND type = 'game' GROUP BY key"),
    loadWordSet(env, request),
    env.DB.prepare("SELECT day, page, message, contact FROM feedback ORDER BY id DESC LIMIT 20")
      .all()
      .then((r) => r.results)
      .catch(() => []),
  ]);

  // Zero-filled daily series, oldest first, so gaps show as gaps in the chart.
  const dayList = [];
  for (let t = Date.parse(chartSince + "T00:00:00Z"); isoDay(t) <= today; t += 86400000) dayList.push(isoDay(t));
  const idx = new Map(dayList.map((d, i) => [d, i]));
  const ids = ["view", "miss", "story", "share", "404", "game"];
  const series = Object.fromEntries(ids.map((id) => [id, dayList.map(() => 0)]));
  const secs = dayList.map(() => 0);
  const cur = Object.fromEntries(ids.map((id) => [id, 0]));
  let curSecs = 0;
  for (const r of daily) {
    const i = idx.get(r.day);
    if (i === undefined) continue;
    const inRange = r.day >= since && r.day <= until;
    if (series[r.type]) {
      series[r.type][i] += r.n;
      if (inRange) cur[r.type] += r.n;
    }
    if (r.type === "time") {
      secs[i] += r.s;
      if (inRange) curSecs += r.s;
    }
  }
  series.time = dayList.map((_, i) => (series.view[i] ? secs[i] / series.view[i] : 0));
  const prev = Object.fromEntries(ids.map((id) => [id, 0]));
  let prevSecs = 0;
  for (const r of prevTotals) {
    if (prev[r.type] !== undefined) prev[r.type] = r.n;
    if (r.type === "time") prevSecs = r.s;
  }
  const avgCur = cur.view ? curSecs / cur.view : 0;
  const avgPrev = prev.view ? prevSecs / prev.view : 0;

  // Games played (the /play game): one count per finished game, in 50-point score buckets
  // (key d:<bucket> = daily game, p:<bucket> = practice). The average is therefore approximate.
  const gameModes = { d: { n: 0, sum: 0 }, p: { n: 0, sum: 0 } };
  for (const r of gameRows) {
    const m = gameModes[String(r.key).charAt(0)];
    const b = Number(String(r.key).slice(2));
    if (!m || !Number.isFinite(b)) continue;
    m.n += r.n;
    m.sum += r.n * Math.min(5000, b + 25);
  }

  const kpis = [
    { m: "view", label: "Word views", value: fmtNum(cur.view), d: delta(cur.view, prev.view) },
    { m: "miss", label: "Missing searches", value: fmtNum(cur.miss), d: delta(cur.miss, prev.miss) },
    { m: "story", label: "Full stories", value: fmtNum(cur.story), d: delta(cur.story, prev.story) },
    { m: "share", label: "Shares", value: fmtNum(cur.share), d: delta(cur.share, prev.share) },
    { m: "game", label: "Games played", value: fmtNum(cur.game), d: delta(cur.game, prev.game) },
    { m: "time", label: "Avg time / view", value: fmtSecs(avgCur), d: delta(avgCur, avgPrev) },
    { m: "404", label: "404 hits", value: fmtNum(cur["404"]), d: delta(cur["404"], prev["404"], true) },
  ];
  const kpiHtml = kpis
    .map(
      (k) =>
        `<button class="kpi" type="button" data-m="${k.m}" aria-pressed="${k.m === "view"}">` +
        `<span class="k">${esc(k.label)}</span><span class="v">${esc(k.value)}</span>` +
        `<span class="d ${k.d.cls}">${esc(k.d.text)}<span style="font-weight:400;color:var(--dim)"> vs previous ${days === 1 ? "day" : days + " days"}</span></span>` +
        `<span class="spark" data-spark="${k.m}"></span></button>`
    )
    .join("");

  // Searches for words that have since been added to the collection are no
  // longer candidates, so they're left out (and counted in the note).
  const stillMissing = wordSet ? misses.filter((r) => !wordSet.has(r.key)) : misses;
  const added = misses.length - stillMissing.length;

  const cards = [
    rankCard({
      id: "missing",
      title: "Missing words people searched for",
      note: "Candidates for the next batches." + (added ? ` ${added} more were searched but are now in the collection.` : ""),
      rows: stillMissing.map((r) => ({ label: r.key, value: fmtNum(r.n), bar: r.n })),
    }),
    rankCard({ id: "views", title: "Most viewed words", rows: views.map((r) => ({ label: r.key, value: fmtNum(r.n), bar: r.n })) }),
    rankCard({
      id: "time",
      title: "Longest average time",
      note: "Words with at least 3 views; visible time only.",
      rows: times.map((r) => ({ label: r.key, sub: `${fmtNum(r.views)} views`, value: fmtSecs(r.secs / r.views), bar: r.secs / r.views })),
    }),
    rankCard({ id: "stories", title: "Full story opened", rows: stories.map((r) => ({ label: r.key, value: fmtNum(r.n), bar: r.n })) }),
    rankCard({
      id: "games",
      title: "Games played",
      note: "Finished games of /play, not counting visitors who send Do Not Track. Average score is approximate (50-point steps).",
      rows: [
        ["Daily game", gameModes.d],
        ["Practice", gameModes.p],
      ]
        .filter(([, m]) => m.n)
        .map(([label, m]) => ({ label, sub: `avg ${fmtNum(Math.round(m.sum / m.n))} points`, value: fmtNum(m.n), bar: m.n })),
    }),
    `<section class="card" id="feedback"><header><h2>Feedback</h2><span class="hr"><span class="badge">${fmtNum(feedbackRows.length)}</span>${FOLD}</span></header>` +
      `<p class="note">The latest 20 messages from the Feedback button.</p>` +
      (feedbackRows.length
        ? `<ol class="fblist">${feedbackRows
            .map(
              (r) =>
                `<li>${esc(r.message)}<small>${esc(r.day)}${r.page ? " &middot; " + esc(r.page) : ""}${r.contact ? " &middot; " + esc(r.contact) : ""}</small></li>`
            )
            .join("")}</ol>`
        : `<p class="empty">No feedback yet</p>`) +
      `</section>`,
    rankCard({ id: "shares", title: "Shared", rows: shares.map((r) => ({ label: r.key, value: fmtNum(r.n), bar: r.n })) }),
    rankCard({
      id: "notfound",
      title: "404 pages",
      note: "Broken or mistyped links people arrived from.",
      rows: notFound.map((r) => ({ label: r.key, value: fmtNum(r.n), bar: r.n })),
    }),
  ].join("");

  const payload = JSON.stringify({
    days: dayList,
    sel: oneDay ? dayList.indexOf(oneDay) : -1,
    series,
    labels: {
      view: "Word views",
      miss: "Missing-word searches",
      story: "Full stories opened",
      share: "Shares",
      game: "Games played",
      time: "Average time per view",
      "404": "404 hits",
    },
  })
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028))
    .join("\\u2028")
    .split(String.fromCharCode(0x2029))
    .join("\\u2029");

  const k = encodeURIComponent(key);
  const rangeHtml = [1, 7, 30, 90, 365]
    .map((d) => `<a href="?key=${k}&amp;days=${d}"${!oneDay && d === days ? ' class="on" aria-current="true"' : ""}>${d}d</a>`)
    .join("");
  const fmtOpt = (d, i) =>
    (i === 0 ? "Today, " : i === 1 ? "Yesterday, " : "") +
    new Date(Date.parse(d + "T00:00:00Z")).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const dayPick =
    `<select class="daypick" id="daypick" aria-label="Show a single day">` +
    `<option value="?key=${k}&amp;days=30">${oneDay ? "Back to date range" : "Single day…"}</option>` +
    dayOpts
      .map((d, i) => `<option value="?key=${k}&amp;day=${d}"${d === oneDay ? " selected" : ""}>${esc(fmtOpt(d, i))}</option>`)
      .join("") +
    `</select>`;
  const themes = [
    ["auto", "Auto (device)", "#fafaf8 50%,#17140f"],
    ["light", "Warm light", "#fafaf8 50%,#b3541e"],
    ["dark", "Warm dark", "#17140f 50%,#e2934f"],
    ["midnight", "Midnight", "#0b1220 50%,#5eb8ff"],
    ["forest", "Forest", "#0e1912 50%,#86d98f"],
    ["paper", "Paper", "#f3f3f1 50%,#4a43d8"],
    ["mono", "Black on white", "#fff 50%,#111"],
    ["ink", "White on black", "#000 50%,#fff"],
  ];
  const themeHtml = themes
    .map(
      ([id, label, grad]) =>
        `<button class="sw" type="button" data-theme="${id}" style="background:linear-gradient(135deg,${grad} 50%)" aria-pressed="false" aria-label="${esc(label)}" title="${esc(label)}"></button>`
    )
    .join("");
  const nav = [
    ["overview", "Overview"],
    ["missing", "Missing words"],
    ["views", "Most viewed"],
    ["time", "Time on page"],
    ["stories", "Stories"],
    ["shares", "Shares"],
    ["games", "Games"],
    ["feedback", "Feedback"],
    ["notfound", "404s"],
  ]
    .map(([id, label]) => `<a href="#${id}">${label}</a>`)
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Etymology Map stats</title>
<script>try{var t=localStorage.getItem("etymology-stats-theme");if(["light","dark","midnight","forest","paper","mono","ink"].indexOf(t)>-1)document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<style>${CSS}</style></head><body><div class="wrap">
<div class="top">
<div class="brand"><div class="logo"><svg viewBox="0 0 100 100" width="19" height="19" aria-hidden="true"><path d="M27,36 L38,67 L50,43 L62,67 L73,36" fill="none" stroke="#e2934f" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
<div><h1>Etymology Map stats</h1><p class="sub-h">${oneDay ? "Single day: " + esc(oneDay) : esc(since) + " to " + esc(today)} (UTC) &middot; anonymous daily totals</p></div></div>
<div class="controls"><div class="themes" role="group" aria-label="Color theme">${themeHtml}<span class="tname" id="tname">Auto</span></div><div class="range" role="navigation" aria-label="Date range">${rangeHtml}</div>${dayPick}</div>
</div>
<nav class="jump" aria-label="Sections">${nav}</nav>
<section id="overview">
<div class="kpis">${kpiHtml}</div>
</section>
<div class="main">
<section class="panel" id="chartpanel"><header><h2 id="chart-title">Word views per day</h2>${FOLD}</header><p class="cap">${oneDay ? "The chart shows the last 15 days with your selected day highlighted; everything else on the page is for that day only." : "Select a card above to chart it."} Hover or tap the chart for exact values.</p>
<div class="chartwrap"><div id="chart"></div><div id="tip" role="status"></div></div></section>
${cards}
</div>
<p class="foot">Totals are added up per day and never tied to a visitor. Older than about 13 months is deleted automatically.</p>
</div>
<script id="sdata" type="application/json">${payload}</script>
<script>${CLIENT_JS}</script>
</body></html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
}
