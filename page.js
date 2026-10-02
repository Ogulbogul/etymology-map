// Shared by the About, Privacy and 404 pages: light/dark toggle in the new header.
import { icon } from "./icons.js?v=2fc470b4";
import "./hint.js?v=2fc470b4";
import "./feedback.js?v=2fc470b4";

const THEME_KEY = "etymology-map-theme";
const btn = document.getElementById("theme-toggle-btn");

function isDarkActive() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  if (theme === "dark" || theme === "light") document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
  const dark = isDarkActive();
  btn.innerHTML = icon(dark ? "sun" : "moon", 18);
  btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

let stored = null;
try { stored = localStorage.getItem(THEME_KEY); } catch (err) { stored = null; }
applyTheme(stored);

btn.addEventListener("click", () => {
  const next = isDarkActive() ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* private mode */ }
  applyTheme(next);
});
