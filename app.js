// ====== Inventory (in-memory + localStorage) ======
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

// ====== UI ======
const video = document.getElementById("video");
const scanStatus = document.getElementById("scanStatus");

const btnStartScan = document.getElementById("btnStartScan");
const btnStopScan = document.getElementById("btnStopScan");
const btnExport = document.getElementById("btnExport");
const btnClear = document.getElementById("btnClear");

const list = document.getElementById("list");
const count = document.getElementById("count");

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

// ====== State ======
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
let stream = null;
let scanning = false;
let handling = false;     // 掃到後進入輸入流程時暫停掃描
let detector = null;      // BarcodeDetector
let zxingLoaded = false;  // fallback
let ZXing = null;

// ====== Render ======
render();

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

function setStatus(msg) {
  scanStatus.textContent = msg;
}

function addQty(code, qty) {
  inventory[code] = (inventory[code] || 0) + qty; // 累加
  saveInventory();
  render();
}

// ====== Dialog flow ======
async function promptQty(code) {
  dlgErr.textContent = "";
  dlgCode.textContent = `條碼：${code}`;
  qtyInput.value = "";
  qtyDialog.showModal();
  qtyInput.focus();

  return new Promise((resolve) => {
    const onOk = () => {
      const v = parseInt(qtyInput.value, 10);
      if (!Number.isFinite(v) || v <= 0) {
        dlgErr.textContent = "請輸入大於 0 的整數";
        return;
      }
      cleanup();
      qtyDialog.close();
      resolve(v);
    };
    const onCancel = () => {
      cleanup();
      qtyDialog.close();
      resolve(null);
    };
    function cleanup() {
      dlgOk.removeEventListener("click", onOk);
      dlgCancel.removeEventListener("click", onCancel);
    }
    dlgOk.addEventListener("click", onOk);
    dlgCancel.addEventListener("click", onCancel);
  });
}

// ====== Camera ======
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

// ====== Detector init ======
async function initDetector() {
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
  await ensureZXing();
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

// ====== Scan loop ======
const LOOP_DELAY_MS = isIOS ? 300 : 120;

async function scanLoop() {
  while (scanning) {
    if (handling) {
      await sleep(LOOP_DELAY_MS);
      continue;
    }
    if (!video.videoWidth) {
      await sleep(LOOP_DELAY_MS);
      continue;
    }

    try {
      const result = detector ? await detectNative() : await detectZXing();
      if (result && result.value) {
        await handleDetected(result.value, result.format);
      }
    } catch {}

    await sleep(LOOP_DELAY_MS);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function detectNative() {
  const codes = await detector.detect(video);
  if (!codes || codes.length === 0) return null;
  const c = codes[0];
  return { value: (c.rawValue || "").trim(), format: c.format };
}

async function detectZXing() {
  // 1) 降低取樣解析度（iPhone 很重要）
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  // 2) 只取畫面中央區域（ROI）提升成功率與速度
  //    取中央 70% 寬、35% 高（可依條碼大小微調）
  const roiW = Math.floor(vw * 0.70);
  const roiH = Math.floor(vh * 0.35);
  const sx = Math.floor((vw - roiW) / 2);
  const sy = Math.floor((vh - roiH) / 2);

  // 3) 把 ROI 縮放到較小尺寸解碼（更快）
  //    目標寬 640（iPhone 上很夠用）
  const targetW = 640;
  const scale = targetW / roiW;
  const targetH = Math.max(240, Math.floor(roiH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, roiW, roiH, 0, 0, targetW, targetH);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // 4) ZXing hints：只解 EAN-13 + CODE128
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.CODE_128
  ]);

  // 可選：告訴 ZXing 這是「純條碼」場景（有時有幫助）
  // hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

  const reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);

  try {
    const res = reader.decodeBitmap(imageData);
    const text = (res.getText() || "").trim();
    const format = String(res.getBarcodeFormat());
    if (!text) return null;
    return { value: text, format };
  } catch {
    return null;
  }
}


// ====== 你要的流程：掃到 -> 跳輸入 -> 回掃描 ======
function isEan13(v) {
  return /^[0-9]{13}$/.test(v);
}

async function handleDetected(value, format) {
  const code = String(value).trim();
  if (!code) return;

  // 基本驗證：EAN-13 必須 13 位數字；Code128 不限制
  const fmt = String(format || "").toLowerCase();
  const looksEAN = fmt.includes("ean") || fmt.includes("ean_13");
  if (looksEAN && !isEan13(code)) return;

  handling = true;               // 暫停掃描
  setStatus(`已掃到：${code}，請輸入數量`);

  const qty = await promptQty(code);  // 2) 跳對話框
  if (qty != null) {
    addQty(code, qty);
    setStatus(`已累加：${code} +${qty}（繼續掃描）`);
  } else {
    setStatus(`已取消：${code}（繼續掃描）`);
  }

  handling = false;              // 3) 回到掃描畫面（恢復 scanLoop）
}

// ====== Buttons ======
btnStartScan.onclick = async () => {
  if (scanning) return;
  scanning = true;
  btnStartScan.disabled = true;
  btnStopScan.disabled = false;

  await startCamera();
  await initDetector();

  setStatus("掃描中…請對準條碼");
  scanLoop();
};

btnStopScan.onclick = async () => {
  scanning = false;
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

function csvEscape(s) {
  const needs = /[",\n\r]/.test(s);
  if (!needs) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

// 手動輸入（保底）
btnAdd1.onclick = () => {
  const c = manualBarcode.value.trim();
  if (c) addQty(c, 1);
};
btnAdd5.onclick = () => {
  const c = manualBarcode.value.trim();
  if (c) addQty(c, 5);
};
btnAdd10.onclick = () => {
  const c = manualBarcode.value.trim();
  if (c) addQty(c, 10);
};
btnAddCustom.onclick = async () => {
  const c = manualBarcode.value.trim();
  if (!c) return;
  const q = await promptQty(c);
  if (q != null) addQty(c, q);
};

// ====== Service Worker: force update ======
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


