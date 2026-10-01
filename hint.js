// A one-time tip under the "Play the Game" header button, shown on a visitor's first visit.
// Whether it has been shown is remembered in local storage; if storage is blocked it is never shown.
const KEY = "etymap-play-tip";
const PLAYED_KEY = "etymap-days";

function run() {
  const pill = document.querySelector(".header-play");
  if (!pill || pill.getAttribute("aria-current") === "page" || !pill.offsetParent) return;
  try {
    if (localStorage.getItem(KEY) || localStorage.getItem(PLAYED_KEY)) return;
    localStorage.setItem(KEY, "1");
  } catch (err) {
    return;
  }

  const tip = document.createElement("div");
  tip.className = "play-tip";
  tip.setAttribute("role", "status");
  const title = document.createElement("b");
  title.textContent = "New: a word game";
  const text = document.createElement("span");
  text.textContent = "Guess where a word travelled, and see how close you get. A new daily word, no sign-up.";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "play-tip-x";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "\u00d7";
  tip.append(title, text, close);

  const place = () => {
    const r = pill.getBoundingClientRect();
    tip.style.top = r.bottom + window.scrollY + 12 + "px";
    tip.style.right = Math.max(12, document.documentElement.clientWidth - r.right) + "px";
    tip.style.maxWidth = Math.max(200, r.right - 16) + "px";
    tip.style.setProperty("--arrow", Math.max(16, r.width / 2 - 6) + "px");
  };
  let timer = null;
  const hide = () => {
    clearTimeout(timer);
    window.removeEventListener("resize", place);
    tip.classList.remove("show");
    setTimeout(() => tip.remove(), 250);
  };
  close.addEventListener("click", hide);
  pill.addEventListener("click", hide);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide());

  document.body.appendChild(tip);
  place();
  window.addEventListener("resize", place);
  requestAnimationFrame(() => requestAnimationFrame(() => tip.classList.add("show")));
  timer = setTimeout(hide, 20000);
}

setTimeout(run, 1500);
