// ===== Version =====
const APP_VERSION = "v0.9.3";
document.getElementById("appVersion").textContent = APP_VERSION;

// ===== Decode settings =====
const ROI_SCALES = [1.5, 2.0, 2.5];
const LOOP_DELAY_MS = 160;

// ===== UI refs =====
const video = document.getElementById("video");
const scanStatus = document.getElementById("scanStatus");
const scanBox = document.getElementById("scanBox");
const btnStart = document.getElementById("btnStartScan");
const btnStop = document.getElementById("btnStopScan");

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
function saveInventory() { localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory)); }
function addQty(code, qty) {
  inventory[code] = (inventory[code] || 0) + qty;
  saveInventory();
  renderInventory();
}
function renderInventory() {
  const keys = Object.keys(inventory).sort();
  count.textContent = String(keys.length);
  list.innerHTML = "";
  for (const k of keys) {
    const li = document.createElement("li");
    li.textContent = `${k} : ${inventory[k]}`;
    list.appendChild(li);
  }
}
function csvEscape(s) {
  const needs = /[",\n\r]/.test(s);
  if (!needs) return s;
  return `"${s.replace(/"/g,'""')}"`;
}
renderInventory();

// ===== Vibration =====
function vibrateOnScan() {
  if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
}

// ===== Camera / Scan state =====
let scanning = false;
let stream = null;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

// ===== Decoders =====
let detector = null; // BarcodeDetector (optional)
let ZXing = null;
let zxingReady = false;
let reader = null;
let hints = null;

async function initDecoders() {
  // 先確保 ZXing 一定可用（iPhone 上最可靠）
  await ensureZXing();

  // BarcodeDetector 只當加速器（iOS 可能不支援 EAN/128）
  detector = null;
  if ("BarcodeDetector" in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const want = ["ean_13", "code_128"];
      const use = want.filter(f => supported.includes(f));
      if (use.length > 0) detector = new window.BarcodeDetector({ formats: use });
    } catch {}
  }
}

async function ensureZXing() {
  if (zxingReady) return;

  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

  ZXing = window.ZXing;

  reader = new ZXing.MultiFormatReader();

  // TRY_HARDER + 指定格式（成功率會明顯提升）
  hints = new Map();
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.CODE_128
  ]);
  reader.setHints(hints);

  zxingReady = true;
}

// ===== Dialog (qty) =====
let resolveQty = null;

function promptQty(code) {
  dlgCode.textContent = `條碼：${code}`;
  qtyInput.value = "";
  qtyDialog.showModal();
  qtyInput.focus();
  return new Promise((resolve) => { resolveQty = resolve; });
}
function closeQty(v) {
  qtyDialog.close();
  const r = resolveQty;
  resolveQty = null;
  r?.(v);
}
dlgOk.onclick = (e) => {
  e.preventDefault();
  const raw = (qtyInput.value || "").trim();
  const v = parseInt(raw, 10);
  if (!raw || !Number.isFinite(v) || v <= 0) {
    alert("請輸入大於 0 的整數");
    qtyInput.focus();
    qtyInput.select?.();
    return;
  }
  closeQty(v);
};
dlgCancel.onclick = (e) => { e.preventDefault(); closeQty(null); };
btnQ1.onclick = () => closeQty(1);
btnQ3.onclick = () => closeQty(3);
btnQ5.onclick = () => closeQty(5);
btnManualJump.onclick = () => {
  closeQty(null);
  setTimeout(() => {
    manualPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    manualBarcode.focus();
  }, 50);
};

// ===== Buttons: inventory =====
btnClear.onclick = () => {
  if (!confirm("確定清空？")) return;
  inventory = {};
  saveInventory();
  renderInventory();
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

// ===== Start/Stop Scan =====
btnStart.onclick = async () => {
  if (scanning) return;
  scanning = true;

  btnStart.disabled = true;
  btnStop.disabled = false;

  try {
    scanStatus.textContent = "啟動相機中…";
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    scanStatus.textContent = "載入解碼器中…";
    await initDecoders(); // ✅ 關鍵：一定等解碼器 ready

    scanStatus.textContent = `掃描中… ROI x${ROI_SCALES.join("/")}（解碼中）`;
    scanLoop();
  } catch (e) {
    scanning = false;
    btnStart.disabled = false;
    btnStop.disabled = true;
    scanStatus.textContent = "相機啟動失敗：請用 Safari 並允許相機";
    alert("相機啟動失敗：請用 Safari 並允許相機權限（不要用 LINE/FB 內建瀏覽器）。");
  }
};

btnStop.onclick = () => {
  scanning = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
  stopCamera();
  scanStatus.textContent = "已停止掃描";
};

function stopCamera() {
  try { stream?.getTracks()?.forEach(t => t.stop()); } catch {}
  stream = null;
  video.srcObject = null;
}

// ===== Scan Loop =====
let busy = false;

async function scanLoop() {
  while (scanning) {
    if (!video.videoWidth || busy) { await sleep(LOOP_DELAY_MS); continue; }
    busy = true;
    try { await scanOnce(); } finally { busy = false; }
    await sleep(LOOP_DELAY_MS);
  }
}

async function scanOnce() {
  const vr = video.getBoundingClientRect();
  const br = scanBox.getBoundingClientRect();

  const sx = (br.left - vr.left) / vr.width * video.videoWidth;
  const sy = (br.top  - vr.top)  / vr.height * video.videoHeight;
  const sw = br.width  / vr.width  * video.videoWidth;
  const sh = br.height / vr.height * video.videoHeight;

  if (sw <= 2 || sh <= 2) return;

  for (const scale of ROI_SCALES) {
    const dw = Math.max(1, (sw * scale) | 0);
    const dh = Math.max(1, (sh * scale) | 0);

    canvas.width = dw;
    canvas.height = dh;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);

    // debug status
    scanStatus.textContent = `掃描中… ROI: ${sw|0}x${sh|0} -> ${dw}x${dh} (x${scale})`;

    // 多輪預處理：原圖 -> 灰階增強 -> 反相
    const modes = ["raw", "enhance", "invert"];
    for (const mode of modes) {
      if (mode === "enhance") applyEnhance(dw, dh);
      if (mode === "invert")  applyInvert(dw, dh);

      // 1) BarcodeDetector（若可用）
      if (detector) {
        try {
          const res = await detector.detect(canvas);
          if (res && res.length) {
            const code = (res[0].rawValue || "").trim();
            if (code) return await onDecoded(code);
          }
        } catch {}
      }

      // 2) ZXing（主力）
      if (reader) {
        try {
          const img = ctx.getImageData(0, 0, dw, dh);
          const src = new ZXing.RGBLuminanceSource(img.data, dw, dh);
          const bin = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src));
          const r = reader.decode(bin);
          const code = (r.getText() || "").trim();
          if (code) return await onDecoded(code);
        } catch {}
      }

      // 還原成原圖（避免 enhance/invert 影響下一輪）
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    }
  }
}

async function onDecoded(code) {
  // ✅ 掃到震動
  vibrateOnScan();

  // 防止同一條碼連續觸發：短暫停 350ms
  scanning = scanning; // no-op
  await sleep(350);

  // ✅ 掃到跳出輸入數量
  const qty = await promptQty(code);
  if (qty != null) addQty(code, qty);
}

// ===== Image preprocess =====
function applyEnhance(w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let y = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
    y = (y - 128) * 1.35 + 128; // 對比（不要太激烈）
    y = y < 0 ? 0 : (y > 255 ? 255 : y);
    d[i] = d[i+1] = d[i+2] = y;
  }
  ctx.putImageData(img, 0, 0);
}

function applyInvert(w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = 255 - d[i];
    d[i+1] = 255 - d[i+1];
    d[i+2] = 255 - d[i+2];
  }
  ctx.putImageData(img, 0, 0);
}

// ===== Utils =====
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
