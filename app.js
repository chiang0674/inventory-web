// ===== App Version (顯示在標題) =====
const APP_VERSION = "v0.9.0";
document.getElementById("appVersion").textContent = APP_VERSION;

// ===== Storage =====
const STORAGE_KEY = "inventory_v1";
let inventory = loadInventory();

function loadInventory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}
function saveInventory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory));
}

// ===== UI =====
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

const btnQ1 = document.getElementById("btnQ1");
const btnQ3 = document.getElementById("btnQ3");
const btnQ5 = document.getElementById("btnQ5");
const btnManualJump = document.getElementById("btnManualJump");

// ===== State =====
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

let stream = null;
let scanning = false;
let handling = false;

let detector = null;      // BarcodeDetector
let ZXing = null;         // fallback
let zxingLoaded = false;
let zxingReader = null;

const roiCanvas = document.createElement("canvas");
const roiCtx = roiCanvas.getContext("2d", { willReadFrequently: true });

// ROI zoom factor
const ROI_SCALE = 1.5;
const LOOP_DELAY_MS = isIOS ? 220 : 140;

render();
setStatus("尚未開始掃描");

// ===== Helpers =====
function setStatus(msg) { scanStatus.textContent = msg; }
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
function isEan13(v) { return /^[0-9]{13}$/.test(v); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function csvEscape(s){
  const needs = /[",\n\r]/.test(s);
  if (!needs) return s;
  return `"${s.replace(/"/g,'""')}"`;
}

// ===== Dialog =====
let currentResolveQty = null;

async function promptQty(code) {
  dlgCode.textContent = `條碼：${code}`;
  qtyInput.value = "";
  qtyDialog.showModal();
  qtyInput.focus();
  return new Promise((resolve) => { currentResolveQty = resolve; });
}
function resolveQty(v){
  const r = currentResolveQty;
  currentResolveQty = null;
  qtyDialog.close();
  r?.(v);
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

dlgOk.addEventListener("click", (e)=>{ e.preventDefault(); validateAndResolveFromInput(); });
dlgCancel.addEventListener("click", (e)=>{ e.preventDefault(); resolveQty(null); });

btnQ1.addEventListener("click", ()=> resolveQty(1));
btnQ3.addEventListener("click", ()=> resolveQty(3));
btnQ5.addEventListener("click", ()=> resolveQty(5));

btnManualJump.addEventListener("click", ()=>{
  resolveQty(null);
  setTimeout(()=>{
    manualPanel.scrollIntoView({behavior:"smooth", block:"start"});
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
  await waitVideoReady();
}

function stopCamera(){
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
}

function waitVideoReady() {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) return resolve();
      if (Date.now() - start > 3000) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// ===== Decoder =====
async function initDecoder() {
  detector = null;
  zxingReader = null;

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

  await ensureZXing();
  zxingReader = new ZXing.MultiFormatReader();
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.CODE_128
  ]);
  zxingReader.setHints(hints);
}

async function ensureZXing(){
  if (zxingLoaded) return;
  await loadScript("https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js");
  ZXing = window.ZXing;
  zxingLoaded = true;
}
function loadScript(src){
  return new Promise((resolve,reject)=>{
    const s=document.createElement("script");
    s.src=src; s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });
}

// ===== ROI =====
function getRoiRectInVideoPixels() {
  const vRect = video.getBoundingClientRect();
  const bRect = scanBoxEl.getBoundingClientRect();

  if (vRect.width <= 0 || vRect.height <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }

  const rx = (bRect.left - vRect.left) / vRect.width;
  const ry = (bRect.top  - vRect.top)  / vRect.height;
  const rw = bRect.width / vRect.width;
  const rh = bRect.height/ vRect.height;

  const sx = Math.max(0, Math.floor(rx * video.videoWidth));
  const sy = Math.max(0, Math.floor(ry * video.videoHeight));
  const sw = Math.max(1, Math.floor(rw * video.videoWidth));
  const sh = Math.max(1, Math.floor(rh * video.videoHeight));

  return {
    sx: Math.min(sx, video.videoWidth - 1),
    sy: Math.min(sy, video.videoHeight - 1),
    sw: Math.min(sw, video.videoWidth - sx),
    sh: Math.min(sh, video.videoHeight - sy)
  };
}

async function detectFromROI() {
  const { sx, sy, sw, sh } = getRoiRectInVideoPixels();
  if (sw <= 0 || sh <= 0) return { r: null, debug: "ROI not ready" };

  const dw = Math.max(1, Math.floor(sw * ROI_SCALE));
  const dh = Math.max(1, Math.floor(sh * ROI_SCALE));

  roiCanvas.width = dw;
  roiCanvas.height = dh;

  roiCtx.imageSmoothingEnabled = true;
  roiCtx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);

  const debug = `ROI: ${sw}x${sh} -> ${dw}x${dh} (x${ROI_SCALE})`;

  if (detector) {
    const codes = await detector.detect(roiCanvas);
    if (codes && codes.length > 0) {
      const c = codes[0];
      return { r: { value: (c.rawValue || "").trim(), format: String(c.format || "").toLowerCase() }, debug };
    }
    return { r: null, debug };
  }

  const imageData = roiCtx.getImageData(0, 0, dw, dh);
  try {
    const luminance = new ZXing.RGBLuminanceSource(imageData.data, dw, dh);
    const binarizer = new ZXing.HybridBinarizer(luminance);
    const bitmap = new ZXing.BinaryBitmap(binarizer);
    const result = zxingReader.decode(bitmap);

    const value = (result.getText() || "").trim();
    const format = String(result.getBarcodeFormat() || "").toLowerCase();
    return { r: value ? { value, format } : null, debug };
  } catch {
    return { r: null, debug };
  }
}

// ===== Scan loop =====
async function scanLoop() {
  while (scanning) {
    if (handling) { await sleep(LOOP_DELAY_MS); continue; }
    if (!video.videoWidth) { await sleep(LOOP_DELAY_MS); continue; }

    const { r, debug } = await detectFromROI();
    setStatus(`掃描中… ${debug}`);

    if (r && r.value) await handleDetected(r.value, r.format);
    await sleep(LOOP_DELAY_MS);
  }
}

async function handleDetected(value, formatLower) {
  const code = String(value).trim();
  if (!code) return;

  const looksEAN = String(formatLower || "").includes("ean");
  if (looksEAN && !isEan13(code)) return;

  handling = true;
  setStatus(`已掃到：${code}（輸入數量）`);

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

  try {
    setStatus("啟動中…請允許相機");
    await startCamera();
    await initDecoder();

    setStatus(`掃描中… ROI x${ROI_SCALE}`);
    scanLoop();
  } catch {
    scanning = false;
    btnStartScan.disabled = false;
    btnStopScan.disabled = true;
    setStatus("相機啟動失敗：請用 Safari 並允許相機權限");
    alert("相機啟動失敗：請用 Safari 開啟並允許相機權限（不要用 LINE/FB 內建瀏覽器）。");
  }
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
  if (keys.length === 0) { alert("目前沒有資料可匯出"); return; }
  const lines = ["barcode,qty"];
  for (const k of keys) lines.push(`${csvEscape(k)},${inventory[k]}`);
  const csv = lines.join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `inventory_${new Date().toISOString().replace(/[:.]/g,"")}.csv`;
  a.click();
};

// Manual input
btnAdd1.onclick = () => { const c = manualBarcode.value.trim(); if (c) addQty(c, 1); };
btnAdd5.onclick = () => { const c = manualBarcode.value.trim(); if (c) addQty(c, 5); };
btnAdd10.onclick = () => { const c = manualBarcode.value.trim(); if (c) addQty(c, 10); };
btnAddCustom.onclick = async () => {
  const c = manualBarcode.value.trim();
  if (!c) return;
  const q = await promptQty(c);
  if (q != null) addQty(c, q);
};

// ===== Service Worker: register (sw 不再快取檔案；避免卡舊版) =====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch {}
  });
}
