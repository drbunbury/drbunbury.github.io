// -------------------- CONFIG --------------------
const frameCount = 83;

const baseUrl = "/images/webp/";
const filePrefix = "VC_Colour";

const padTo = 4;
const ext = "webp";

// Global scale
const baseScale = 0.8;

// Mobile scaling
const mobileMaxCssWidth = 520;
const mobileScale = 0.8;

// Right-edge anchor offset from canvas center
const rightEdgeOffsetPx = null;
const rightEdgeOffsetRatio = null;

// Hide overlay once everything is decoded
const READY_THRESHOLD = frameCount;

// Optional dwell weights (0-indexed)
const weights = Array.from({ length: frameCount }, () => 1);

// Dwell at each 'open' frame
weights[0] = 24;
weights[12] = 24;
weights[24] = 24;
weights[36] = 24;
weights[49] = 24;
weights[61] = 24;
weights[73] = 24;
weights[82] = 24;

// -------------------- DOM --------------------
const header = document.getElementById("siteHeader");
const section = document.getElementById("sequenceSection");
const canvas = document.getElementById("sequenceCanvas");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

const overlay = document.getElementById("loadingOverlay");
const barEl = document.getElementById("loadingBar"); // may be null
const pctEl = document.getElementById("loadingPct");

const errorOverlay = document.getElementById("errorOverlay");
const errorText = document.getElementById("errorText");

const crossTrace = document.getElementById("crossTrace");
let crossLen = 0;

function initCrossTrace() {
  if (!crossTrace) return;
  crossLen = crossTrace.getTotalLength();
  crossTrace.style.strokeDasharray = String(crossLen);
  crossTrace.style.strokeDashoffset = String(crossLen);
}

function setCrossProgress(progress01) {
  if (!crossTrace || !crossLen) return;
  const p = clamp(progress01, 0, 1);
  crossTrace.style.strokeDashoffset = String(crossLen * (1 - p));
}

// -------------------- Scroll lock --------------------
let scrollLockY = 0;

function lockScroll() {
  scrollLockY = window.scrollY || window.pageYOffset || 0;

  // Prevent layout jump by fixing the body in place
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.width = "100%";
  document.body.style.top = `-${scrollLockY}px`;

  // Extra safety: block wheel/touch/keys that scroll
  window.addEventListener("wheel", preventScroll, { passive: false });
  window.addEventListener("touchmove", preventScroll, { passive: false });
  window.addEventListener("keydown", preventScrollKeys, { passive: false });
}

function unlockScroll() {
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  document.body.style.position = "";
  document.body.style.width = "";
  const top = document.body.style.top;
  document.body.style.top = "";

  window.removeEventListener("wheel", preventScroll);
  window.removeEventListener("touchmove", preventScroll);
  window.removeEventListener("keydown", preventScrollKeys);

  // Restore the scroll position we froze at
  const y = top ? Math.abs(parseInt(top, 10)) : scrollLockY;
  window.scrollTo(0, y);
}

function preventScroll(e) {
  e.preventDefault();
}

function preventScrollKeys(e) {
  // Space, PageUp/Down, End, Home, arrows
  const keys = [" ", "PageUp", "PageDown", "End", "Home", "ArrowUp", "ArrowDown"];
  if (keys.includes(e.key)) e.preventDefault();
}

// -------------------- Menu --------------------
const menuBtn = document.getElementById("menuBtn");
const menuPanel = document.getElementById("menuPanel");
const menuBackdrop = document.getElementById("menuBackdrop");

function setMenuOpen(open) {
  menuBtn.setAttribute("aria-expanded", String(open));
  menuPanel.dataset.open = String(open);
  menuBackdrop.dataset.open = String(open);
  menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}

menuBtn.addEventListener("click", () => {
  const open = menuBtn.getAttribute("aria-expanded") === "true";
  setMenuOpen(!open);
});

menuBackdrop.addEventListener("click", () => setMenuOpen(false));
window.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenuOpen(false); });
menuPanel.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setMenuOpen(false)));

// -------------------- Utils --------------------
function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

function frameUrl(i) {
  const n = String(i + 1).padStart(padTo, "0");
  return `${baseUrl}${filePrefix}${n}.${ext}`;
}

// -------------------- Weighted dwell timeline --------------------
let totalWeight = 0;
const cumulative = [];
for (let i = 0; i < frameCount; i++) {
  totalWeight += weights[i];
  cumulative.push(totalWeight);
}

function frameFromProgress(progress01) {
  const target = progress01 * totalWeight;
  let lo = 0, hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (target <= cumulative[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// -------------------- Cache/decode --------------------
const cache = new Map();
const inFlight = new Set();
const decodedSet = new Set();

function updateLoadingUI() {
  const progress01 = decodedSet.size / frameCount;
  const pct = Math.round(progress01 * 100);

  pctEl.textContent = `${pct}%`;
  setCrossProgress(progress01);

  if (decodedSet.size >= READY_THRESHOLD && overlay) {
    unlockScroll();
    overlay.style.transition = "opacity 250ms ease";
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 260);
  }
}

function showError(message) {
  try { overlay?.remove(); } catch {}
  if (errorText) {
    errorText.innerHTML =
      `${message}<br><br>` +
      `Expected files like <code>${baseUrl}${filePrefix}0001.${ext}</code>.<br>`;
  }
  if (errorOverlay) errorOverlay.dataset.show = "true";
}

async function decodeFrame(index) {
  if (cache.has(index)) return cache.get(index);
  if (inFlight.has(index)) return null;

  inFlight.add(index);
  try {
    const url = frameUrl(index);
    const resp = await fetch(url, { cache: "force-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);

    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);

    cache.set(index, bitmap);
    if (!decodedSet.has(index)) {
      decodedSet.add(index);
      updateLoadingUI();
    }
    return bitmap;
  } finally {
    inFlight.delete(index);
  }
}

// -------------------- Draw: centered, crop overflow --------------------
function drawBitmapCenteredNoScaleCrop(bitmap, frameIndex) {
  const dpr = window.devicePixelRatio || 1;

  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || (window.innerHeight - (header?.getBoundingClientRect().height ?? 0));

  const targetW = Math.max(1, Math.floor(cssW * dpr));
  const targetH = Math.max(1, Math.floor(cssH * dpr));

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const isMobile = (window.innerWidth || canvas.clientWidth) <= mobileMaxCssWidth;

  const deviceScale = isMobile ? mobileScale : 1;
  const desiredScale = baseScale * deviceScale;

  const maxImageHeight = canvas.height * 0.95;
  const heightFitScale = maxImageHeight / (bitmap.height * dpr);
  const scale = Math.min(desiredScale, heightFitScale);

  const dw = bitmap.width * dpr * scale;
  const dh = bitmap.height * dpr * scale;

  let dx = (canvas.width - dw) / 2;
  const centerX = canvas.width / 2;

  if (typeof rightEdgeOffsetPx === "number") {
    const offset = rightEdgeOffsetPx * dpr * scale;
    dx = (centerX + offset) - dw;
  } else if (typeof rightEdgeOffsetRatio === "number") {
    const offset = dw * rightEdgeOffsetRatio;
    dx = (centerX + offset) - dw;
  }

  const dy = (canvas.height - dh) / 2;

  const visX0 = Math.max(0, dx);
  const visY0 = Math.max(0, dy);
  const visW = Math.min(canvas.width, dx + dw) - visX0;
  const visH = Math.min(canvas.height, dy + dh) - visY0;

  if (visW <= 0 || visH <= 0) return;

  const sx = (visX0 - dx) / (dpr * scale);
  const sy = (visY0 - dy) / (dpr * scale);
  const sw = visW / (dpr * scale);
  const sh = visH / (dpr * scale);

  ctx.drawImage(bitmap, sx, sy, sw, sh, visX0, visY0, visW, visH);
}

// -------------------- Scroll handling --------------------
function computeProgress() {
  const rect = section.getBoundingClientRect();
  const headerH = header?.getBoundingClientRect().height ?? 0;
  const viewportH = window.innerHeight - headerH;
  const total = rect.height - viewportH;
  return total <= 0 ? 0 : clamp((-rect.top) / total, 0, 1);
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;

  requestAnimationFrame(async () => {
    try {
      const frame = frameFromProgress(computeProgress());
      const bitmap = await decodeFrame(frame);
      if (bitmap) drawBitmapCenteredNoScaleCrop(bitmap, frame);
    } catch (e) {
      console.error(e);
      showError(String(e));
    } finally {
      ticking = false;
    }
  });
}

window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);

// -------------------- Init --------------------
(async function init() {
  lockScroll();
  initCrossTrace();
  try {
    const first = await decodeFrame(0);
    if (!first) throw new Error("Failed to decode first frame.");
    drawBitmapCenteredNoScaleCrop(first, 0);

    for (let i = 1; i < frameCount; i++) {
      if (i % 10 === 0) await new Promise(requestAnimationFrame);
      await decodeFrame(i);
    }

    onScroll();
  } catch (e) {
    console.error(e);
    showError(String(e));
  }
})();
