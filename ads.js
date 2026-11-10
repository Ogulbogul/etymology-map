// Consent banner and ad loading. Does nothing unless ads-config.js turned at
// least one ad space on. Ads are only requested after the visitor chose, or
// when their browser sends a Global Privacy Control / Do Not Track signal
// (treated as "non-personalized only").
(function () {
  "use strict";
  var C = window.EM_ADS;
  var root = document.documentElement;
  if (!C || !/\bsl-(bm|bd|rail|bar)\b/.test(root.className)) return;

  var KEY = "em-ad-consent"; // "all" | "limited"
  var loaded = false;
  var mode = null;
  var banner = null;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function store(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }
  function boxes() {
    return [].slice.call(document.querySelectorAll(".ad-box[data-slot]"));
  }
  function shown(el) {
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  function load(m) {
    if (loaded) return;
    loaded = true;
    mode = m;
    if (!C.publisher) {
      boxes().forEach(function (b) {
        if (shown(b)) b.textContent = "Ad preview " + b.getAttribute("data-w") + "×" + b.getAttribute("data-h");
      });
      return;
    }
    var q = (window.adsbygoogle = window.adsbygoogle || []);
    if (m === "limited") q.requestNonPersonalizedAds = 1;
    var s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(C.publisher);
    document.head.appendChild(s);
    boxes().forEach(function (b) {
      var id = C.slots[b.getAttribute("data-slot")];
      if (!id || !shown(b) || b.querySelector("ins")) return;
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.cssText = "display:inline-block;width:" + b.getAttribute("data-w") + "px;height:" + b.getAttribute("data-h") + "px";
      ins.setAttribute("data-ad-client", C.publisher);
      ins.setAttribute("data-ad-slot", id);
      b.appendChild(ins);
      try { q.push({}); } catch (e) {}
    });
  }

  function choose(v) {
    var changed = loaded && mode !== v;
    store(v);
    if (banner) { banner.remove(); banner = null; }
    if (changed) location.reload();
    else load(v);
  }

  function showBanner() {
    if (banner) return;
    banner = document.createElement("div");
    banner.className = "ad-consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Advertising choices");
    banner.innerHTML =
      '<p>Etymology Map is free and paid for by ads. You choose what kind. Personalized ads use cookies to show ads based on your visits. ' +
      'Non-personalized ads use only the page you are on. <a href="/privacy">Privacy Policy</a></p>' +
      '<div class="ad-consent-actions">' +
      '<button type="button" class="btn btn-outline" data-v="limited">Non-personalized</button>' +
      '<button type="button" class="btn btn-outline" data-v="all">Personalized</button></div>';
    banner.addEventListener("click", function (e) {
      var v = e.target && e.target.getAttribute && e.target.getAttribute("data-v");
      if (v) choose(v);
    });
    document.body.appendChild(banner);
  }

  function start() {
    if (!C.publisher) {
      boxes().forEach(function (b) {
        if (shown(b)) b.textContent = "Ad preview " + b.getAttribute("data-w") + "\u00d7" + b.getAttribute("data-h");
      });
    }
    var link = document.querySelector(".ad-choices");
    if (link) link.addEventListener("click", showBanner);
    if (C.googleMessaging) return load("all"); // Google's own message handles consent
    var v = stored();
    if (v === "all" || v === "limited") return load(v);
    if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1") return load("limited");
    showBanner();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
