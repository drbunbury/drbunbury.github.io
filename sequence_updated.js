// -------------------- CONFIG --------------------
const frameCount = 83;

// COLOR set
const baseUrlColor = "/images/webp/";
const filePrefixColor = "VC_Colour";

// BW set
const baseUrlBW = "/images/webp_bw/";
const filePrefixBW = "VC_BW";

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
const barEl = document.getElementById("loadingBar");
const pctEl = document.getElementById("loadingPct");

const errorOverlay = document.getElementById("errorOverlay");
const errorText = document.getElementById("errorText");

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

// -------------------- Set selection (measured probe) --------------------
function connHintsSaySlow() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return false;

  const saveData = !!conn.saveData;
  const effectiveType = conn.effectiveType || "";
  const slowType = ["slow-2g", "2g"].includes(effectiveType); // be stricter here
  const downlink = typeof conn.downlink === "number" ? conn.downlink : null;
  const rtt = typeof conn.rtt === "number" ? conn.rtt : null;

  // Treat these as strong hints, not gospel
  const lowDownlink = downlink !== null && downlink <= 1.0;
  const highRtt = rtt !== null && rtt >= 450;

  return saveData || slowType || lowDownlink || highRtt;
}

async function timedFetch(url, { timeoutMs = 2000, cache = "no-store" } = {}) {
  const controller = new AbortController();
  const t0 = performance.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { cache, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const t1 = performance.now();
    return { ms: t1 - t0, bytes: blob.size };
  } finally {
    clearTimeout(timer);
  }
}

async function chooseBWvsColor() {
  // 1) strong user/device hint
  if (connHintsSaySlow()) return true;

  // 2) If the user explicitly prefers reduced data (nice extra signal)
  if (window.matchMedia && window.matchMedia("(prefers-reduced-data: reduce)").matches) {
    return true;
  }

  // 3) Real probe: try fetching COLOR frame 1 quickly.
  // If it’s slow, prefer BW.
  const colorFirstUrl = `${baseUrlColor}${filePrefixColor}${String(1).padStart(padTo, "0")}.${ext}`;

  try {
    const { ms, bytes } = await timedFetch(colorFirstUrl, { timeoutMs: 2200, cache: "no-store" });

    // Estimate Mbps from this sample
    const mbps = (bytes * 8) / (ms / 1000) / 1_000_000;

    // Thresholds: tune for your content.
    // If the first frame is taking ages or throughput is low, go BW.
    const tooSlowTime = ms > 1200;     // >1.2s for one frame feels sluggish
    const tooSlowMbps = mbps < 3.0;    // <3 Mbps is often “painful” for heavy sequences

    return tooSlowTime || tooSlowMbps;
  } catch {
    // Probe failed or timed out => safer to go BW
    return true;
  }
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

// Decide BW vs COLOR once at load time (based on connection only)
function shouldUseBW() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  // If not supported, default to COLOR
  if (!conn) return false;

  const saveData = !!conn.saveData;
  const effectiveType = conn.effectiveType || ""; // slow-2g,2g,3g,4g
  const slowType = ["slow-2g", "2g", "3g"].includes(effectiveType);

  const downlink = typeof conn.downlink === "number" ? conn.downlink : null; // Mbps
  const lowDownlink = downlink !== null && downlink <= 1.5;

  // RTT in ms (if provided)
  const rtt = typeof conn.rtt === "number" ? conn.rtt : null;
  const highRtt = rtt !== null && rtt >= 300;

  return saveData || slowType || lowDownlink || highRtt;
}

let useBW = false;
let baseUrl = baseUrlColor;
let filePrefix = filePrefixColor;

function drawDebugFrameLabel(frameIndex, dx, dy, dw, dh) {
  const dpr = window.devicePixelRatio || 1;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const setLabel = useBW ? "BW" : "COLOR";
  const text = `${setLabel} — Frame ${frameIndex + 1} / ${frameCount}`;

  const fontPx = Math.max(14, Math.round(16 * dpr));
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  const metrics = ctx.measureText(text);
  const padX = Math.round(10 * dpr);
  const padY = Math.round(6 * dpr);

  const w = Math.ceil(metrics.width + padX * 2);
  const h = Math.ceil(fontPx + padY * 2);

  const x = Math.round(dx + dw / 2);
  const margin = Math.round(12 * dpr);
  const y = Math.round(dy + dh - margin);

  const left = x - w / 2;
  const top = y - h;

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(1, Math.round(1 * dpr));

  const r = Math.round(8 * dpr);
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.arcTo(left + w, top, left + w, top + h, r);
  ctx.arcTo(left + w, top + h, left, top + h, r);
  ctx.arcTo(left, top + h, left, top, r);
  ctx.arcTo(left, top, left + w, top, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#111";
  ctx.fillText(text, x, y - padY);

  ctx.restore();
}

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
  const pct = Math.round((decodedSet.size / frameCount) * 100);
  barEl.style.width = `${pct}%`;
  pctEl.textContent = `${pct}%`;

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

  // Debug label (bottom-centre of drawn image)
  //if (typeof frameIndex === "number") {
  //  drawDebugFrameLabel(frameIndex, dx, dy, dw, dh);
  //}
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
  try {
    useBW = await chooseBWvsColor();
    baseUrl = useBW ? baseUrlBW : baseUrlColor;
    filePrefix = useBW ? filePrefixBW : filePrefixColor;

    console.log("Sequence set:", useBW ? "BW" : "COLOR");
    console.log("First frame URL:", frameUrl(0));

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