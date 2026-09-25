// Anonymous usage counts for Etymology Map.
//
// Sends small batches of events to /api/e, where they are only added to
// daily totals (see functions/api/e.js). Nothing here identifies a visitor:
// no cookies, no local storage, no visitor or session ID, no IP address is
// stored. The totals are used to find popular words that are missing from
// the collection and to see which parts of the site people actually use.
//
// Tracking is skipped entirely on localhost and for visitors whose browser
// sends a Global Privacy Control or Do Not Track signal.
(function () {
  "use strict";

  var ENDPOINT = "/api/e";
  var MAX_SECONDS = 1800;
  var queue = [];
  var disabled = false;

  try {
    var host = location.hostname;
    if (!host || host === "localhost" || host === "127.0.0.1") disabled = true;
    if (navigator.globalPrivacyControl === true) disabled = true;
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") disabled = true;
  } catch (err) {
    disabled = true;
  }

  function push(type, key, seconds) {
    if (disabled || !key) return;
    var ev = { t: type, k: String(key).slice(0, 80) };
    if (seconds) ev.s = seconds;
    queue.push(ev);
    if (queue.length >= 20) flush();
  }

  function flush() {
    if (disabled || !queue.length) return;
    var body = JSON.stringify(queue);
    queue = [];
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      } else {
        fetch(ENDPOINT, {
          method: "POST",
          body: body,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        });
      }
    } catch (err) {}
  }

  // Time spent on the word currently shown, counted only while the tab is
  // visible. It is reported when the visitor moves to another word or
  // leaves the page.
  var timer = null;

  function reportTime() {
    if (!timer) return;
    if (timer.since) {
      timer.ms += Date.now() - timer.since;
      timer.since = 0;
    }
    var seconds = Math.min(MAX_SECONDS, Math.round(timer.ms / 1000));
    if (seconds >= 1) push("time", timer.word, seconds);
    timer.ms = 0;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      reportTime();
      flush();
    } else if (timer && !timer.since) {
      timer.since = Date.now();
    }
  });
  window.addEventListener("pagehide", function () {
    reportTime();
    flush();
  });

  window.emTrack = {
    // A word's journey was shown (word page or a search on the home page).
    view: function (word) {
      reportTime();
      push("view", word);
      timer = { word: word, ms: 0, since: document.visibilityState === "visible" ? Date.now() : 0 };
    },
    // A search for a word that isn't in the collection yet.
    miss: function (query) {
      push("miss", query);
    },
    // "Read the full story" was opened.
    story: function (word) {
      push("story", word);
    },
    // The Share button was used.
    share: function (word) {
      push("share", word);
    },
    // Someone landed on a page that doesn't exist.
    notFound: function (path) {
      push("404", path);
    },
  };
})();
