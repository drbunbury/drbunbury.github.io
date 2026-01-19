// sequence.js
// Fixes:
// 1) Menu open/close restored
// 2) Loads frames from absolute /images/webp/ (WebP only)

const frameCount = 140;

// Expected files:
//   /images/webp/product_0001.webp ... product_0100.webp
const baseUrl = "/images/webp/";
const filePrefix = "product_";
const padTo = 4;
const ext = "webp";

// Global scale (applies on all devices)
const baseScale = 0.8; // 80% everywhere (tweak)

// Mobile scaling
const mobileMaxCssWidth = 520;   // treat <= this as "mobile"
const mobileScale = 0.65;        // 65% size on mobile (tweak)

// Right-edge anchor offset from canvas center
// Use ONE of these:
const rightEdgeOffsetPx = 100;   // e.g. 100 image pixels to the right of centre
// const rightEdgeOffsetRatio = 0.1; // e.g. 10% of image width to the right of centre

// Hide overlay once everything is decoded
const READY_THRESHOLD = frameCount;

// Optional dwell weights (0-indexed)
const weights = Array.from({ length: frameCount }, () => 1);
// Example dwell (edit/remove as needed)
weights[4] = 6;
weights[9] = 4;

// DOM
const header = document.getElementById("siteHeader");
const section = document.getElementById("sequenceSection");
const canvas = document.getElementById("sequenceCanvas");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

const overlay = document.getElementById("loadingOverlay");
const barEl = document.getElementById("loadingBar");
const pctEl = document.getElementById("loadingPct");

const errorOverlay = document.getElementById("errorOverlay");
const errorText = document.getElementById("errorText");

// Menu
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

// Utils
function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

function frameUrl(i) {
  const n = String(i + 1).padStart(padTo, "0");
  return `${baseUrl}${filePrefix}${n}.${ext}`;
}

// Weighted dwell timeline
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

// Cache/decode
const cache = new Map();
const inFlight = new Set();
const decodedSet = new Set();

function updateLoadingUI() {
  const pct = Math.round((decodedSet.size / frameCount) * 100);
  barEl.style.width = `${pct}%`;
  pctEl.textContent = `${pct}%`;

  if (decodedSet.size >= READY_THRESHOLD && overlay) {
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
      `Expected files like <code>${baseUrl}${filePrefix}0001.${ext}</code>.<br>`
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

// Draw: centered, no scaling, crop overflow
function drawBitmapCenteredNoScaleCrop(bitmap) {
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

    // Base + device scaling
    const deviceScale = isMobile ? mobileScale : 1;
    const desiredScale = baseScale * deviceScale;

    // Maximum allowed height (80% of visible canvas)
    const maxImageHeight = canvas.height * 0.8;

    // Scale needed to fit height constraint
    const heightFitScale = maxImageHeight / (bitmap.height * dpr);

    // Final scale = smallest valid scale
    const scale = Math.min(desiredScale, heightFitScale);

    // Final draw size
    const dw = bitmap.width * dpr * scale;
    const dh = bitmap.height * dpr * scale;

  // ---- NEW: anchor image's RIGHT EDGE relative to canvas centre ----
  const centerX = canvas.width / 2;

  // Choose one offset mode:
    const offset = (typeof rightEdgeOffsetPx === "number")
      ? rightEdgeOffsetPx * dpr * scale   // scale it so layout stays consistent
      : (typeof rightEdgeOffsetRatio === "number")
        ? (dw * rightEdgeOffsetRatio)
        : 0;

  // Place right edge at centerX + offset
  const dx = (centerX + offset) - dw;

  // keep vertical centering
  const dy = (canvas.height - dh) / 2;
  // ---------------------------------------------------------------

  const visX0 = Math.max(0, dx);
  const visY0 = Math.max(0, dy);
  const visW = Math.min(canvas.width, dx + dw) - visX0;
  const visH = Math.min(canvas.height, dy + dh) - visY0;

  if (visW <= 0 || visH <= 0) return;

  // Convert visible device-pixel region back into source (bitmap) pixels.
  // We need to undo BOTH dpr and scale.
  const sx = (visX0 - dx) / (dpr * scale);
  const sy = (visY0 - dy) / (dpr * scale);
  const sw = visW / (dpr * scale);
  const sh = visH / (dpr * scale);

  ctx.drawImage(
    bitmap,
    sx, sy, sw, sh,   // source rect in bitmap pixels
    visX0, visY0, visW, visH // dest rect in canvas device pixels
  );
}

// Scroll handling
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
      if (bitmap) drawBitmapCenteredNoScaleCrop(bitmap);
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

// Init
(async function init() {
  try {
    const first = await decodeFrame(0);
    if (!first) throw new Error("Failed to decode first frame.");
    drawBitmapCenteredNoScaleCrop(first);

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
