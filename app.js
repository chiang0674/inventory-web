// ===== Storage =====
const STORAGE_KEY = "inventory_v1";
let inventory = loadInventory();

function loadInventory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}
function saveInventory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory));
}

// ===== UI refs =====
const video = document.getElementById("video");
const scanStatus = document.getElementById("scanStatus");
const scanBoxEl = document.getElementById("scanBox");

const btnStartScan = document.getElementById("btnStartScan");
const btnStopScan = document.getElementById("btnStopScan");
const btnExport = document.getElementById("btnExport");
const btnClear = document.getElementById("btnClear");

const list = document.getElementById("list");
const count = document.getElementById("count");

const manualPanel = document.getElementById("manualPanel");
const manualBarcode = document.getElementById("manualBarcode");
const btnAdd1 = document.getElementById("btnAdd1");
const btnAdd5 = document.getElementById("btnAdd5");
const btnAdd10 = document.getElementById("btnAdd10");
const btnAddCustom = document.getElementById("btnAddCustom");

const qtyDialog = document.getElementById("qtyDialog");
const dlgCode = document.getElementById("dlgCode");
const qtyInput = document.getElementById("qtyInput");
const dlgOk = document.getElementById("dlgOk");
const dlgCancel = document.getElementById("dlgCancel");
const dlgErr = document.getElementById("dlgErr");

// quick qty buttons
const btnQ1 = document.getElementById("btnQ1");
const btnQ3 = document.getElementById("btnQ3");
const btnQ5 = document.getElementById("btnQ5");
const btnManualJump = document.getElementById("btnManualJump");

// ===== State =====
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

let stream = null;
let scanning = false;
let handling = false;

// Decoder
let detector = null;      // BarcodeDetector
let ZXing = null;         // fallback
let zxingLoaded = false;
let zxingReader = null;

// ROI canvas
const roiCanvas = document.createElement("canvas");
const roiCtx = roiCanvas.getContext("2d", { willReadFrequently: true });

// ROI zoom factor
const ROI_SCALE = 1.5;

render();
setStatus("尚未開始掃描");

// ===== Helpers =====
function setStatus(msg) {
  scanStatus.textContent = msg;
}

function render() {
  list.innerHTML = "";
  const keys = Object.keys(inventory).sort();
  count.textContent = String(keys.length);
  for (const code of keys) {
    const li = document.createElement("li");
    li.textContent = `${code} : ${inventory[code]}`;
    list.appendChild(li);
  }
}

function addQty(code, qty) {
  inventory[code] = (inventory[code] || 0) + qty;
  saveInventory();
  render();
}

function isEan13(v) {
  return /^[0-9]{13}$/.test(v);
}

function csvEscape(s) {
  const needs = /[",\n\r]/.test(s);
  if (!needs) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ===== Dialog: scan -> qty -> back to scan =====
let currentResolveQty = null;

async function promptQty(code) {
  dlgErr.textContent = "";
  dlgCode.textContent = `條碼：${code}`;
  qtyInput.value = "";
  qtyDialog.showModal();
  qtyInput.focus();

  return new Promise((resolve) => {
    currentResolveQty = resolve;
  });
}

function resolveQty(valueOrNull) {
  if (typeof currentResolveQty === "function") {
    const r = currentResolveQty;
    currentResolveQty = null;
    qtyDialog.close();
    r(valueOrNull);
  } else {
    qtyDialog.close();
  }
}

function validateAndResolveFromInput() {
  const raw = (qtyInput.value || "").trim();
  const v = parseInt(raw, 10);
  if (!raw || !Number.isFinite(v) || v <= 0) {
    alert("請輸入大於 0 的整數");
    qtyInput.focus();
    qtyInput.select?.();
    return;
  }
  resolveQty(v);
}

// Dialog button handlers
dlgOk.addEventListener("click", (e) => {
  e.preventDefault();
  validateAndResolveFromInput();
});
dlgCancel.addEventListener("click", (e) => {
  e.preventDefault();
  resolveQty(null);
});

// Quick qty: 1 / 3 / 5 (one-tap confirm)
btnQ1.addEventListener("click", () => resolveQty(1));
btnQ3.addEventListener("click", () => resolveQty(3));
btnQ5.addEventListener("click", () => resolveQty(5));

// Manual jump button (close dialog -> scroll to manual input)
btnManualJump.addEventListener("click", () => {
  resolveQty(null);
  setTimeout(() => {
    manualPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    manualBarcode.focus();
  }, 50);
});

// ===== Camera =====
async function startCamera() {
  if (stream) return;

  const constraints = {
    video: {
      facingMode: { ideal: "environment" },
      width:  { ideal: isIOS ? 1280 : 1920 },
      height: { ideal: isIOS ? 720  : 1080 }
    },
    audio: false
  };

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  video.muted = true;
  await video.play();
}

function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
}

// ===== Decoder init =====
async function initDecoder() {
  // Prefer native BarcodeDetector
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      const want = ["ean_13", "code_128"];
      const use = want.filter(f => formats.includes(f));
      if (use.length > 0) {
        detector = new window.BarcodeDetector({ formats: use });
        return;
      }
    } catch {}
  }

  // Fallback: ZXing
  await ensureZXing();
  zxingReader = new ZXing.MultiFormatReader();
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.CODE_128
  ]);
  zxingReader.setHints(hints);
}

async function ensureZXing() {
  if (zxingLoaded) return;
  await loadScript("https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js");
  ZXing = window.ZXing;
  zxingLoaded = true;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ===== ROI mapping: only scan inside box =====
function getRoiRectInVideoPixels() {
  const vRect = video.getBoundingClientRect();
  const bRect = scanBoxEl.getBoundingClientRect();

  const rx = (bRect.left - vRect.left) / vRect.width;
  const ry = (bRect.top  - vRect.top)  / vRect.height;
  const rw = bRect.width / vRect.width;
  const rh = bRect.height/ vRect.height;

  const vx = Math.max(0, Math.floor(rx * video.videoWidth));
  const vy = Math.max(0, Math.floor(ry * video.videoHeight));
  const vw = Math.max(1, Math.floor(rw * video.videoWidth));
  const vh = Math.max(1, Math.floor(rh * video.videoHeight));

  const sx = Math.min(vx, video.videoWidth - 1);
  const sy = Math.min(vy, video.videoHeight - 1);
  const sw = Math.min(vw, video.videoWidth - sx);
  const sh = Math.min(vh, video.videoHeight - sy);

  return { sx, sy, sw, sh };
}

// ROI detect with 1.5x upscaling
async function detectFromROI() {
  const { sx, sy, sw, sh } = getRoiRectInVideoPixels();

  const dw = Math.max(1, Math.floor(sw * ROI_SCALE));
  const dh = Math.max(1, Math.floor(sh * ROI_SCALE));

  roiCanvas.width = dw;
  roiCanvas.height = dh;

  // Draw ROI scaled up to canvas
  roiCtx.imageSmoothingEnabled = true;
  roiCtx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);

  // Native detector on canvas
  if (detector) {
    const codes = await detector.detect(roiCanvas);
    if (codes && codes.length > 0) {
      const c = codes[0];
      return {
        value: (c.rawValue || "").trim(),
        format: String(c.format || "").toLowerCase()
      };
    }
    return null;
  }

  // ZXing decode on scaled ROI imageData
  const imageData = roiCtx.getImageData(0, 0, dw, dh);
  try {
    const luminance = new ZXing.RGBLuminanceSource(imageData.data, dw, dh);
    const binarizer = new ZXing.HybridBinarizer(luminance);
    const bitmap = new ZXing.BinaryBitmap(binarizer);

    const result = zxingReader.decode(bitmap);
    const value = (result.getText() || "").trim();
    const format = String(result.getBarcodeFormat() || "").toLowerCase();
    if (!value) return null;
    return { value, format };
  } catch {
    return null;
  }
}

// ===== Scan loop =====
const LOOP_DELAY_MS = isIOS ? 200 : 120;

async function scanLoop() {
  while (scanning) {
    if (handling) { await sleep(LOOP_DELAY_MS); continue; }
    if (!video.videoWidth) { await sleep(LOOP_DELAY_MS); continue; }

    const r = await detectFromROI();
    if (r && r.value) await handleDetected(r.value, r.format);

    await sleep(LOOP_DELAY_MS);
  }
}

// ===== Workflow: scan -> dialog -> back to scan =====
async function handleDetected(value, formatLower) {
  const code = String(value).trim();
  if (!code) return;

  const looksEAN = String(formatLower || "").includes("ean");
  if (looksEAN && !isEan13(code)) return;

  handling = true;
  setStatus(`已掃到：${code}，請輸入數量`);

  const qty = await promptQty(code);
  if (qty != null) {
    addQty(code, qty);
    setStatus(`已累加：${code} +${qty}（回到掃描）`);
  } else {
    setStatus(`已取消：${code}（回到掃描）`);
  }

  handling = false;
}

// ===== Buttons =====
btnStartScan.onclick = async () => {
  if (scanning) return;
  scanning = true;
  handling = false;

  btnStartScan.disabled = true;
  btnStopScan.disabled = false;

  setStatus("啟動中…請允許相機");
  await startCamera();
  await initDecoder();

  setStatus(`掃描中…只掃框內（ROI x${ROI_SCALE}）`);
  scanLoop();
};

btnStopScan.onclick = () => {
  scanning = false;
  handling = false;

  btnStartScan.disabled = false;
  btnStopScan.disabled = true;

  setStatus("已停止掃描");
  stopCamera();
};

btnClear.onclick = () => {
  if (!confirm("確定清空？")) return;
  inventory = {};
  saveInventory();
  render();
  setStatus("已清空");
};

btnExport.onclick = () => {
  const keys = Object.keys(inventory).sort();
  if (keys.length === 0) {
    alert("目前沒有資料可匯出");
    return;
  }

  const lines = ["barcode,qty"];
  for (const k of keys) lines.push(`${csvEscape(k)},${inventory[k]}`);
  const csv = lines.join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `inventory_${new Date().toISOString().replace(/[:.]/g,"")}.csv`;
  a.click();
};

// Manual input fallback
btnAdd1.onclick = () => { const c = manualBarcode.value.trim(); if (c) addQty(c, 1); };
btnAdd5.onclick = () => { const c = manualBarcode.value.trim(); if (c) addQty(c, 5); };
btnAdd10.onclick = () => { const c = manualBarcode.value.trim(); if (c) addQty(c, 10); };
btnAddCustom.onclick = async () => {
  const c = manualBarcode.value.trim();
  if (!c) return;
  const q = await promptQty(c);
  if (q != null) addQty(c, q);
};

// ===== Service Worker: force update =====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");

      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });

      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) {
            w.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    } catch {}
  });
}
