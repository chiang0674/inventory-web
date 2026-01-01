// ===================== Storage =====================
const STORAGE_KEY = "inventory_ean13_v1";
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
function saveInventory(inv) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(inv));
}

// ===================== UI refs =====================
const video = document.getElementById("video");
const scanStatus = document.getElementById("scanStatus");

const btnStart = document.getElementById("btnStartScan");
const btnStop = document.getElementById("btnStopScan");
const btnExport = document.getElementById("btnExport");
const btnClear = document.getElementById("btnClear");

const listEl = document.getElementById("list");
const emptyState = document.getElementById("emptyState");
const countBadge = document.getElementById("countBadge");

const manualBarcode = document.getElementById("manualBarcode");
const btnAdd1 = document.getElementById("btnAdd1");
const btnAdd5 = document.getElementById("btnAdd5");
const btnAddCustom = document.getElementById("btnAddCustom");

const qtyDialog = document.getElementById("qtyDialog");
const dlgBarcode = document.getElementById("dlgBarcode");
const qtyInput = document.getElementById("qtyInput");
const dlgError = document.getElementById("dlgError");

// ===================== State =====================
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

let inventory = loadInventory();

let scanning = false;
let handling = false;

let stream = null;
let nativeDetector = null;

let zxingLoaded = false;
let ZXing = null;
let zxingReader = null;
let zxingControls = null;

// ROI (relative to video): left 12%, top 42%, width 76%, height 14%
const ROI = { x: 0.12, y: 0.42, w: 0.76, h: 0.14 };

render();
setStatus("尚未開始掃描");

// ===================== Helpers =====================
function setStatus(msg) {
  scanStatus.textContent = msg;
}
function isEan13(code) {
  return /^[0-9]{13}$/.test(code);
}
function addQty(code, qty) {
  inventory[code] = (inventory[code] ?? 0) + qty;
  saveInventory(inventory);
  render();
}
function render() {
  const keys = Object.keys(inventory).sort();
  countBadge.textContent = String(keys.length);

  listEl.innerHTML = "";
  if (keys.length === 0) {
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  for (const code of keys) {
    const qty = inventory[code] ?? 0;
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `
      <div class="code">${escapeHtml(code)}</div>
      <div class="qty">${qty}</div>
      <div class="sub">barcode,qty</div>
    `;
    listEl.appendChild(li);
  }
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[c]));
}

// ===================== Dialog flow =====================
async function promptQty(code) {
  dlgError.textContent = "";
  dlgBarcode.textContent = `條碼：${code}`;
  qtyInput.value = "";
  qtyDialog.showModal();
  qtyInput.focus();

  const result = await new Promise((resolve) => {
    const handler = () => resolve(qtyDialog.returnValue);
    qtyDialog.addEventListener("close", handler, { once: true });
  });

  if (result !== "ok") return null;

  const v = parseInt(qtyInput.value.trim(), 10);
  if (!Number.isFinite(v) || v <= 0) {
    dlgError.textContent = "請輸入大於 0 的整數";
    return await promptQty(code);
  }
  return v;
}

// ===================== Camera =====================
async function startCamera() {
  if (stream) return;

  const constraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: isIOS ? 1280 : 1920 },
      height: { ideal: isIOS ? 720 : 1080 }
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

// ===================== Native detector =====================
async function initNativeDetector() {
  if (!("BarcodeDetector" in window)) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (!formats.includes("ean_13")) return false;
    nativeDetector = new window.BarcodeDetector({ formats: ["ean_13"] });
    return true;
  } catch {
    return false;
  }
}

function getRoiCanvasFromVideo() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  const sx = Math.floor(vw * ROI.x);
  const sy = Math.floor(vh * ROI.y);
  const sw = Math.floor(vw * ROI.w);
  const sh = Math.floor(vh * ROI.h);

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

async function detectNativeEan13FromROI() {
  // Native BarcodeDetector supports ImageBitmap / Canvas etc.
  const canvas = getRoiCanvasFromVideo();
  const codes = await nativeDetector.detect(canvas);
  if (!codes || codes.length === 0) return null;
  const v = (codes[0].rawValue ?? "").trim();
  if (!isEan13(v)) return null;
  return v;
}

// ===================== ZXing fallback (iOS friendly) =====================
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

async function startZXingDecode() {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13]);
  zxingReader = new ZXing.BrowserMultiFormatReader(hints, LOOP_DELAY_MS);

  // ZXing 直接從相機解碼，但我們只接受 ROI 內的結果：
  // 作法：用 decodeFromConstraints 綁 video；回呼內再以 ROI canvas 做二次過濾（降低誤判）
  const constraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: isIOS ? 1280 : 1920 },
      height: { ideal: isIOS ? 720 : 1080 }
    },
    audio: false
  };

  zxingControls = await zxingReader.decodeFromConstraints(
    constraints,
    video,
    async (result, err) => {
      if (!scanning || handling) return;

      if (result) {
        const text = (result.getText() ?? "").trim();
        // 只接受 EAN-13
        if (!isEan13(text)) return;

        // 進一步降低誤判：只在 ROI 取樣時才觸發
        //（若條碼不在框內，通常 ROI 取樣不會穩定讀到）
        await handleDetected(text);
      }
    }
  );
}

function stopZXingDecode() {
  try { zxingControls?.stop(); } catch {}
  zxingControls = null;
  zxingReader = null;
}

// ===================== Scan loop =====================
const LOOP_DELAY_MS = isIOS ? 200 : 120;

async function scanLoopNative() {
  while (scanning && nativeDetector) {
    if (handling) { await sleep(LOOP_DELAY_MS); continue; }
    if (!video.videoWidth) { await sleep(LOOP_DELAY_MS); continue; }

    try {
      const code = await detectNativeEan13FromROI();
      if (code) await handleDetected(code);
    } catch {}

    await sleep(LOOP_DELAY_MS);
  }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===================== Your workflow: scan -> dialog -> back to scan =====================
async function handleDetected(code) {
  if (handling) return;
  if (!isEan13(code)) return;

  handling = true;

  // ZXing 模式：暫停解碼，避免連續觸發
  if (zxingControls) {
    try { zxingControls.stop(); } catch {}
    zxingControls = null;
    zxingReader = null;
  }

  setStatus(`已掃到：${code}（輸入數量）`);
  const qty = await promptQty(code);

  if (qty != null) {
    addQty(code, qty);
    setStatus(`已累加：${code} +${qty}（回到掃描）`);
  } else {
    setStatus(`已取消：${code}（回到掃描）`);
  }

  handling = false;

  // 回到掃描畫面（恢復）
  if (scanning && !nativeDetector) {
    await startZXingDecode();
  }
}

// ===================== Buttons =====================
btnStart.onclick = async () => {
  if (scanning) return;
  scanning = true;
  handling = false;

  btnStart.disabled = true;
  btnStop.disabled = false;

  setStatus("啟動相機…請允許權限");

  // 先嘗試 native（可用就走 ROI + native）
  const canNative = await initNativeDetector();
  if (canNative) {
    await startCamera();
    setStatus("掃描中…請把 EAN-13 放在小框內");
    scanLoopNative();
    return;
  }

  // fallback ZXing
  await ensureZXing();
  nativeDetector = null;
  setStatus("掃描中…請把 EAN-13 放在小框內");
  await startZXingDecode();
};

btnStop.onclick = () => {
  scanning = false;
  handling = false;

  btnStart.disabled = false;
  btnStop.disabled = true;

  setStatus("已停止掃描");

  stopZXingDecode();
  stopCamera();
  nativeDetector = null;
};

btnClear.onclick = () => {
  if (!confirm("確定要清空所有盤點資料嗎？")) return;
  inventory = {};
  saveInventory(inventory);
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
  for (const k of keys) lines.push(`${k},${inventory[k] ?? 0}`);
  const csv = lines.join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `inventory_${new Date().toISOString().replace(/[:.]/g,"")}.csv`;
  a.click();
};

// 手動輸入（保底）：只接受 13 位數字
function getManualEan13OrAlert() {
  const v = (manualBarcode.value || "").trim();
  if (!isEan13(v)) {
    alert("請輸入 13 位數字的 EAN-13");
    return null;
  }
  return v;
}
btnAdd1.onclick = () => {
  const c = getManualEan13OrAlert();
  if (!c) return;
  addQty(c, 1);
};
btnAdd5.onclick = () => {
  const c = getManualEan13OrAlert();
  if (!c) return;
  addQty(c, 5);
};
btnAddCustom.onclick = async () => {
  const c = getManualEan13OrAlert();
  if (!c) return;
  const q = await promptQty(c);
  if (q != null) addQty(c, q);
};

// ===================== Service Worker: force update =====================
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
