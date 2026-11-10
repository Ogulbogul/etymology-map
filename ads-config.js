// Advertising settings. Ads stay completely off (no scripts, no cookies, no
// banner, no reserved space) until a publisher ID is filled in below.
//
// To turn ads on after AdSense approves the site:
//   1. Put the publisher ID in `publisher`, e.g. "ca-pub-1234567890123456".
//   2. Paste each ad unit's ID into `slots`. A slot left empty is not shown.
//   3. Put the same publisher number in /ads.txt (the line is ready there).
//   4. Run `python3 stamp_assets.py`.
//
// Preview without any account: open any page with ?adspreview=1 added to the
// address to see the consent banner and the reserved ad spaces.
//
// This file must stay small and load before the page is drawn: it only sets
// classes on <html> so the ad spaces are reserved from the very first paint.
(function () {
  "use strict";
  var C = (window.EM_ADS = {
    publisher: "", // your AdSense ID is ca-pub-7145862083376260; leave empty until the site is approved
    // true = use Google's own consent message (set up in AdSense under
    // Privacy & messaging) instead of our banner. Needed for visitors in the
    // EU, UK and Switzerland, where Google requires its certified tool.
    googleMessaging: false,
    slots: {
      bottomMobile: "", // 300 x 250, below the content on phones
      bottomDesktop: "", // 728 x 90, below the content on tablets and desktops
      side: "", // 160 x 600, rails beside the content on wide screens
      sticky: "", // 320 x 50, stuck to the bottom of phone screens
    },
  });
  C.preview = /[?&]adspreview=1(&|$)/.test(location.search);
  var live = !!C.publisher;
  if (C.preview && !live) document.documentElement.classList.add("ad-preview");
  function use(cls, id) {
    if (live ? id : C.preview) document.documentElement.classList.add(cls);
  }
  use("ad-bottom-m", C.slots.bottomMobile);
  use("ad-bottom-d", C.slots.bottomDesktop);
  use("ad-side", C.slots.side);
  use("ad-sticky", C.slots.sticky);
})();
