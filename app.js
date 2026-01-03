const APP_VERSION = "v0.9.2";
document.getElementById("appVersion").textContent = APP_VERSION;

const ROI_SCALES = [1.5, 2.0, 2.5];

const video = document.getElementById("video");
const scanStatus = document.getElementById("scanStatus");
const scanBox = document.getElementById("scanBox");

const btnStart = document.getElementById("btnStartScan");
const btnStop = document.getElementById("btnStopScan");

// 盤點功能（先保留 UI 元件，後續你要整合掃到->輸入數量 可再接）
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

// ====== Storage ======
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
function addQty(code, qty) {
  inventory[code] = (inventory[code] || 0) + qty;
  saveInventory();
  renderInventory();
}
function csvEscape(s) {
  const needs = /[",\n\r]/.test(s);
  if (!needs) return s;
  return `"${s.replace(/"/g,'""')}"`;
}
renderInventory();

// ====== Vibration (掃到震動回饋) ======
function vibrateOnScan() {
  // iOS Safari 多數可用；若不可用會無聲失敗
  if (navigator.vibrate) {
    navigator.vibrate([40, 30, 40]); // 兩段短震
  }
}

// ====== Scanner ======
let scanning = false;
let stream = null;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently:true });

let detector = null;
let ZXing = null;
let reader = null;

(async ()=>{
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      // 只要這兩種
      detector = new window.BarcodeDetector({ formats: ["ean_13","code_128"].filter(f=>formats.includes(f)) });
      if (!detector) await loadZXing();
    } catch {
      await loadZXing();
    }
  } else {
    await loadZXing();
  }
})();

async function loadZXing(){
  await new Promise((resolve, reject)=>{
    const s=document.createElement("script");
    s.src="https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js";
    s.onload=resolve;
    s.onerror=reject;
    document.head.appendChild(s);
  });
  ZXing = window.ZXing;
  reader = new ZXing.MultiFormatReader();
}

btnStart.onclick = async ()=>{
  if (scanning) return;
  scanning = true;
  btnStart.disabled = true;
  btnStop.disabled = false;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }, audio:false });
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    loop();
  } catch (e) {
    scanning = false;
    btnStart.disabled = false;
    btnStop.disabled = true;
    alert("相機啟動失敗：請用 Safari 並允許相機權限（不要用內建瀏覽器）");
  }
};

btnStop.onclick = ()=>{
  scanning = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
  stream?.getTracks().forEach(t=>t.stop());
  stream = null;
  video.srcObject = null;
  scanStatus.textContent = "已停止掃描";
};

async function loop(){
  while(scanning){
    await scanOnce();
    await sleep(180);
  }
}

async function scanOnce(){
  if(!video.videoWidth) return;

  const vr = video.getBoundingClientRect();
  const br = scanBox.getBoundingClientRect();

  const sx = (br.left-vr.left)/vr.width*video.videoWidth;
  const sy = (br.top-vr.top)/vr.height*video.videoHeight;
  const sw = br.width/vr.width*video.videoWidth;
  const sh = br.height/vr.height*video.videoHeight;

  for(const scale of ROI_SCALES){
    const dw = sw*scale|0, dh = sh*scale|0;
    canvas.width = dw; canvas.height = dh;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);

    enhance(ctx, dw, dh);

    scanStatus.textContent = `掃描中… ROI: ${sw|0}x${sh|0} -> ${dw}x${dh} (x${scale})`;

    // Native detector
    if(detector){
      try{
        const res = await detector.detect(canvas);
        if(res && res.length){
          const code = (res[0].rawValue || "").trim();
          if (code) {
            vibrateOnScan();           // ✅ 掃到震動
            await onScanned(code);     // ✅ 後續流程（輸入數量）
            return;
          }
        }
      }catch{}
    }

    // ZXing fallback
    if(reader){
      try{
        const img = ctx.getImageData(0,0,dw,dh);
        const src = new ZXing.RGBLuminanceSource(img.data,dw,dh);
        const bin = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src));
        const r = reader.decode(bin);
        const code = (r.getText() || "").trim();
        if (code) {
          vibrateOnScan();           // ✅ 掃到震動
          await onScanned(code);     // ✅ 後續流程（輸入數量）
          return;
        }
      }catch{}
    }
  }
}

// 影像增強：灰階 + 對比
function enhance(ctx,w,h){
  const img = ctx.getImageData(0,0,w,h);
  const d = img.data;
  for(let i=0;i<d.length;i+=4){
    let y = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    y = (y-128)*1.4+128;
    y = Math.max(0,Math.min(255,y));
    d[i]=d[i+1]=d[i+2]=y;
  }
  ctx.putImageData(img,0,0);
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ====== 掃到後：跳出輸入數量（含快速 1/3/5，回到掃描） ======
let resolveQty = null;

async function onScanned(code){
  // 暫停一小段，避免同一個影像連續解到同條碼
  scanning = scanning; // no-op

  const qty = await promptQty(code);
  if (qty == null) return;

  addQty(code, qty);
}

function promptQty(code){
  dlgCode.textContent = `條碼：${code}`;
  qtyInput.value = "";
  qtyDialog.showModal();
  qtyInput.focus();

  return new Promise((resolve)=>{
    resolveQty = resolve;
  });
}

function closeQty(v){
  qtyDialog.close();
  const r = resolveQty;
  resolveQty = null;
  r?.(v);
}

dlgOk.onclick = (e)=>{
  e.preventDefault();
  const raw = (qtyInput.value||"").trim();
  const v = parseInt(raw,10);
  if(!raw || !Number.isFinite(v) || v<=0){
    alert("請輸入大於 0 的整數");
    qtyInput.focus();
    qtyInput.select?.();
    return;
  }
  closeQty(v);
};

dlgCancel.onclick = (e)=>{
  e.preventDefault();
  closeQty(null);
};

btnQ1.onclick = ()=>closeQty(1);
btnQ3.onclick = ()=>closeQty(3);
btnQ5.onclick = ()=>closeQty(5);

btnManualJump.onclick = ()=>{
  closeQty(null);
  setTimeout(()=>{
    manualPanel.scrollIntoView({behavior:"smooth", block:"start"});
    manualBarcode.focus();
  }, 50);
};

// ====== 手動輸入（保底） ======
btnAdd1.onclick = ()=>{ const c=manualBarcode.value.trim(); if(c) addQty(c,1); };
btnAdd5.onclick = ()=>{ const c=manualBarcode.value.trim(); if(c) addQty(c,5); };
btnAdd10.onclick = ()=>{ const c=manualBarcode.value.trim(); if(c) addQty(c,10); };
btnAddCustom.onclick = async ()=>{
  const c=manualBarcode.value.trim();
  if(!c) return;
  const q = await promptQty(c);
  if(q!=null) addQty(c,q);
};

// ====== 匯出 / 清空 ======
btnClear.onclick = ()=>{
  if(!confirm("確定清空？")) return;
  inventory = {};
  saveInventory();
  renderInventory();
};

btnExport.onclick = ()=>{
  const keys = Object.keys(inventory).sort();
  if(keys.length===0){ alert("目前沒有資料可匯出"); return; }

  const lines = ["barcode,qty"];
  for(const k of keys) lines.push(`${csvEscape(k)},${inventory[k]}`);
  const csv = lines.join("\n");

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `inventory_${new Date().toISOString().replace(/[:.]/g,"")}.csv`;
  a.click();
};
