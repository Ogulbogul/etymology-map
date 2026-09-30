// The globe view: a solid, shaded sphere (d3-geo orthographic) with the
// traced route drawn as great-circle arcs and small numbered pins.
//
// Two layouts share one renderer:
//   "rise" - a large sphere rising from the bottom of the landing page
//   "full" - a whole sphere next to the stage list on a result page
//
// It slowly sways around the route (about 1 degree every 2 seconds) so the
// route never leaves view, and pauses on drag, when the tab is hidden, when
// the pause button is pressed, and always under reduced motion.

const SVG_NS = "http://www.w3.org/2000/svg";
const R = 400; // sphere radius in svg units; viewBox adds a margin around it
const SWAY_DEG = 30;
const SWAY_PERIOD_S = 240; // peak speed ~0.8 deg/s, average ~0.5 deg/s
const PIN_PX = 8;
const PIN_PX_SELECTED = 10;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (parent) parent.appendChild(node);
  return node;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function normLon(lon) {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  return l;
}

// Mean direction of a set of [lon, lat] points, returned as [lon, lat].
function centroid(points) {
  let x = 0, y = 0, z = 0;
  points.forEach(([lon, lat]) => {
    const a = (lon * Math.PI) / 180;
    const b = (lat * Math.PI) / 180;
    x += Math.cos(b) * Math.cos(a);
    y += Math.cos(b) * Math.sin(a);
    z += Math.sin(b);
  });
  const n = points.length || 1;
  x /= n; y /= n; z /= n;
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  const lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
  return [lon, lat];
}

export function createGlobe({ host, d3geo, land, onSelect, onHover }) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const projection = d3geo.geoOrthographic().scale(R).translate([R, R]).clipAngle(90);
  const pathGen = d3geo.geoPath(projection);
  const graticule = d3geo.geoGraticule().step([15, 15])();

  // --- static svg scaffold (built once; only path data changes per frame)
  const svg = el("svg", {
    class: "globe-svg",
    viewBox: "-60 -60 920 920",
    role: "img",
    "aria-label": "Globe showing the word's route",
    preserveAspectRatio: "xMidYMid meet",
  });
  const defs = el("defs", {}, svg);
  const mkGrad = (id, type, attrs, stops) => {
    const g = el(type, { id, ...attrs }, defs);
    stops.forEach(([offset, cssVar, opacity]) => {
      const s = el("stop", { offset }, g);
      s.style.stopColor = `var(${cssVar})`;
      if (opacity !== undefined) s.style.stopOpacity = opacity;
    });
  };
  mkGrad("gl-ocean", "radialGradient", { cx: "36%", cy: "30%", r: "85%" }, [["0", "--g-ocean-1"], ["1", "--g-ocean-2"]]);
  mkGrad("gl-land", "linearGradient", { x1: "0", y1: "0", x2: "1", y2: "1" }, [["0", "--g-land-1"], ["1", "--g-land-2"]]);
  mkGrad("gl-vignette", "radialGradient", { cx: "36%", cy: "30%", r: "78%" }, [["0.55", "--g-shade", "0"], ["1", "--g-shade", "var(--g-shade-opacity)"]]);
  mkGrad("gl-atmo", "radialGradient", { cx: "50%", cy: "50%", r: "50%" }, [["0.86", "--accent", "0"], ["0.93", "--accent", "var(--g-atmo-opacity)"], ["1", "--accent", "0"]]);
  const clip = el("clipPath", { id: "gl-clip" }, defs);
  el("circle", { cx: R, cy: R, r: R }, clip);

  el("circle", { class: "g-atmo", cx: R, cy: R, r: 480, fill: "url(#gl-atmo)" }, svg);
  el("circle", { class: "g-ring", cx: R, cy: R, r: 436 }, svg);
  el("circle", { class: "g-ocean", cx: R, cy: R, r: R, fill: "url(#gl-ocean)" }, svg);
  const clipped = el("g", { "clip-path": "url(#gl-clip)" }, svg);
  const gratEl = el("path", { class: "g-grat" }, clipped);
  const landGlowEl = el("path", { class: "g-land-glow" }, clipped);
  const landEl = el("path", { class: "g-land", fill: "url(#gl-land)" }, clipped);
  el("circle", { class: "g-vignette", cx: R, cy: R, r: R, fill: "url(#gl-vignette)" }, clipped);
  const arcsG = el("g", { class: "g-arcs" }, clipped);
  const pinsG = el("g", { class: "g-pins" }, clipped);
  el("circle", { class: "g-rim", cx: R, cy: R, r: R }, svg);
  host.appendChild(svg);

  // --- state
  let stops = [];
  let arcEls = [];
  let pinEls = [];
  let selected = -1;
  let hovered = -1;
  let variant = "rise";
  let labelMode = false; // preview (landing): label first and last stop
  let lon = 20;
  let lat = -10;
  let baseLon = 20; // the sway oscillates around this
  let baseLat = -10;
  let swayPhase = 0; // radians; advances only while the sway is actually running
  let swaySpeed = 0; // 0..1, eased so the sway starts and stops smoothly
  let lastT = performance.now();
  let userPaused = false;
  let dragging = false;
  let idleUntil = 0;
  let anim = null;
  let frame = null;
  let lastDrawn = { lon: NaN, lat: NaN };
  let pxWidth = 600;

  function swayActive() {
    return !userPaused && !dragging && !reducedMotion.matches && !document.hidden && stops.length > 0 && performance.now() > idleUntil;
  }

  function measure() {
    const w = svg.getBoundingClientRect().width;
    if (w > 0) pxWidth = w;
  }

  function pinRadiusUnits(selectedPin) {
    const small = pxWidth < 520;
    const px = (selectedPin ? PIN_PX_SELECTED : PIN_PX) * (small ? 0.85 : 1);
    return { r: px * (920 / pxWidth), px };
  }

  function buildRoute() {
    arcsG.innerHTML = "";
    pinsG.innerHTML = "";
    arcEls = [];
    pinEls = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const arc = el("path", { class: "g-arc", pathLength: "1" }, arcsG);
      arcEls.push(arc);
    }
    stops.forEach((stop, i) => {
      const g = el("g", { class: "gpin", "data-idx": String(i), tabindex: "0", role: "button", "aria-label": `Stage ${i + 1}: ${stop.word}` }, pinsG);
      el("circle", { class: "gpin-halo" }, g);
      el("circle", { class: "gpin-dot" }, g);
      const num = el("text", { class: "gpin-num", "text-anchor": "middle", dy: ".35em" }, g);
      num.textContent = String(i + 1);
      const label = el("text", { class: "gpin-label" }, g);
      label.textContent = stop.word;
      g.addEventListener("pointerenter", () => onHover && onHover(i, true));
      g.addEventListener("pointerleave", () => onHover && onHover(i, false));
      g.addEventListener("click", () => { if (!suppressClick) onSelect && onSelect(i); });
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect && onSelect(i);
        }
      });
      pinEls.push(g);
    });
  }

  function draw() {
    projection.rotate([-lon, -lat]);
    const landD = pathGen(land) || "";
    landEl.setAttribute("d", landD);
    landGlowEl.setAttribute("d", landD);
    gratEl.setAttribute("d", pathGen(graticule) || "");
    const center = [lon, lat];
    arcEls.forEach((arc, i) => {
      const a = [stops[i].lon, stops[i].lat];
      const b = [stops[i + 1].lon, stops[i + 1].lat];
      arc.setAttribute("d", pathGen({ type: "LineString", coordinates: [a, b] }) || "");
    });
    pinEls.forEach((g, i) => {
      const s = stops[i];
      const p = projection([s.lon, s.lat]);
      const visible = p && d3geo.geoDistance([s.lon, s.lat], center) < (Math.PI / 2) * 0.97;
      g.style.display = visible ? "" : "none";
      if (!visible) return;
      const isSel = i === selected || i === hovered;
      const { r, px } = pinRadiusUnits(isSel);
      const dot = g.querySelector(".gpin-dot");
      const halo = g.querySelector(".gpin-halo");
      const num = g.querySelector(".gpin-num");
      const label = g.querySelector(".gpin-label");
      dot.setAttribute("cx", p[0]); dot.setAttribute("cy", p[1]); dot.setAttribute("r", r);
      halo.setAttribute("cx", p[0]); halo.setAttribute("cy", p[1]); halo.setAttribute("r", r * 1.9);
      num.setAttribute("x", p[0]); num.setAttribute("y", p[1]);
      num.setAttribute("font-size", Math.max(9, px * 1.3) * (920 / pxWidth));
      const showLabel = labelMode && (i === 0 || i === stops.length - 1);
      label.style.display = showLabel ? "" : "none";
      if (showLabel) {
        const right = i === 0;
        label.setAttribute("x", p[0] + (right ? 1 : -1) * (r + 6 * (920 / pxWidth)));
        label.setAttribute("y", p[1] + 4 * (920 / pxWidth));
        label.setAttribute("text-anchor", right ? "start" : "end");
        label.setAttribute("font-size", 14 * (920 / pxWidth));
      }
      g.classList.toggle("is-active", isSel);
    });
    lastDrawn = { lon, lat };
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.dur);
      const e = easeInOutCubic(t);
      lon = normLon(anim.from[0] + anim.dLon * e);
      lat = anim.from[1] + (anim.to[1] - anim.from[1]) * e;
      if (t >= 1) {
        baseLon = anim.to[0];
        baseLat = anim.to[1];
        swayPhase = 0;
        swaySpeed = 0;
        anim = null;
      }
      lastT = now;
      draw();
      return;
    }
    // Sway: integrate the phase, so pausing (hover, drag, tab switch) and
    // resuming continues from the same spot instead of snapping to a new one.
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    swaySpeed += ((swayActive() ? 1 : 0) - swaySpeed) * Math.min(1, dt * 2.5);
    if (swaySpeed > 0.002 && !dragging) {
      swayPhase += ((2 * Math.PI) / SWAY_PERIOD_S) * dt * swaySpeed;
      const nextLon = normLon(baseLon + SWAY_DEG * Math.sin(swayPhase));
      // Skip sub-pixel moves: redrawing the whole coastline costs more than it shows.
      if (Math.abs(normLon(nextLon - lastDrawn.lon)) > 0.02) {
        lon = nextLon;
        lat = baseLat;
        draw();
      }
    }
  }

  function startLoop() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function rotateTo(targetLon, targetLat, duration = 900) {
    if (reducedMotion.matches || duration <= 0) {
      lon = baseLon = normLon(targetLon);
      lat = baseLat = targetLat;
      anim = null;
      draw();
      return;
    }
    let dLon = normLon(targetLon) - lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    anim = { t0: performance.now(), dur: duration, from: [lon, lat], to: [normLon(targetLon), targetLat], dLon };
  }

  function routeCenter() {
    if (!stops.length) return [20, variant === "rise" ? 10 : 25];
    const [cLon, cLat] = centroid(stops.map((s) => [s.lon, s.lat]));
    // On the rising landing globe the sphere's centre sits far below the
    // fold, so look from further south to keep the route in the top cap.
    return [cLon, variant === "rise" ? cLat - 52 : cLat];
  }

  // --- pointer drag to rotate
  let dragStart = null;
  let dragMoved = false;
  let pendingPointer = 0;
  let suppressClick = false;
  svg.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragMoved = false;
    anim = null;
    dragStart = { x: e.clientX, y: e.clientY, lon, lat };
    pendingPointer = e.pointerId;
  });
  svg.addEventListener("pointermove", (e) => {
    if (!dragging || !dragStart) return;
    if (!dragMoved && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) < 4) return;
    if (!dragMoved) {
      dragMoved = true;
      try { svg.setPointerCapture(pendingPointer); } catch (err) { /* pointer already gone */ }
      svg.classList.add("is-dragging");
      host.dispatchEvent(new CustomEvent("globe-drag", { bubbles: true }));
    }
    const k = 180 / (pxWidth * 0.8); // degrees per pixel at the sphere's centre
    lon = normLon(dragStart.lon - (e.clientX - dragStart.x) * k);
    lat = Math.max(-75, Math.min(75, dragStart.lat + (e.clientY - dragStart.y) * k));
    draw();
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    dragStart = null;
    if (dragMoved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
    baseLon = lon;
    baseLat = lat;
    swayPhase = 0;
    swaySpeed = 0;
    idleUntil = performance.now() + 4000;
    svg.classList.remove("is-dragging");
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("pointerenter", () => { idleUntil = Math.max(idleUntil, performance.now() + 1500); });
  svg.addEventListener("pointermove", () => { if (!dragging) idleUntil = Math.max(idleUntil, performance.now() + 1500); });

  window.addEventListener("resize", () => { measure(); draw(); });
  if (window.ResizeObserver) new ResizeObserver(() => { measure(); draw(); }).observe(host);

  measure();
  draw();
  startLoop();

  return {
    element: svg,
    setVariant(v, recenterNow = true) {
      variant = v;
      host.dataset.variant = v;
      measure();
      if (recenterNow) {
        const [cLon, cLat] = routeCenter();
        rotateTo(cLon, cLat, 0);
      }
    },
    setStops(next, opts = {}) {
      stops = next;
      labelMode = !!opts.labels;
      selected = -1;
      hovered = -1;
      buildRoute();
      measure();
      const [cLon, cLat] = routeCenter();
      rotateTo(cLon, cLat, opts.animate ? 900 : 0);
      if (opts.animate) {
        svg.classList.remove("is-revealed");
        void svg.getBoundingClientRect();
        svg.classList.add("is-revealed");
      } else {
        svg.classList.add("is-revealed");
      }
      arcEls.forEach((a, i) => a.style.setProperty("--i", String(i)));
      pinEls.forEach((p, i) => p.style.setProperty("--i", String(i)));
      draw();
    },
    clearRoute() {
      stops = [];
      buildRoute();
      draw();
    },
    setSelected(i) { selected = i; draw(); },
    setHover(i) { hovered = i; draw(); },
    recenter(duration = 700) {
      const [cLon, cLat] = routeCenter();
      rotateTo(cLon, cLat, duration);
    },
    setPaused(p) { userPaused = p; if (!p) { baseLon = lon; baseLat = lat; swayPhase = 0; swaySpeed = 0; } },
    isPaused: () => userPaused,
    // A playful entrance: the sphere rolls in from the side while the route redraws.
    spinIn(duration = 1300) {
      if (reducedMotion.matches) return;
      const [cLon, cLat] = routeCenter();
      lon = baseLon = normLon(cLon - 110);
      lat = baseLat = cLat;
      draw();
      rotateTo(cLon, cLat, duration);
      svg.classList.remove("is-revealed");
      void svg.getBoundingClientRect();
      svg.classList.add("is-revealed");
    },
    resize() { measure(); draw(); },
  };
}
