const inventory = {};
const list = document.getElementById("list");
const count = document.getElementById("count");

function render() {
  list.innerHTML = "";
  const keys = Object.keys(inventory);
  count.textContent = keys.length;

  keys.forEach(k => {
    const li = document.createElement("li");
    li.textContent = `${k} : ${inventory[k]}`;
    list.appendChild(li);
  });
}

function addQty(code, qty) {
  inventory[code] = (inventory[code] || 0) + qty;
  render();
}

document.getElementById("btnAdd1").onclick = () => {
  const v = manualBarcode.value.trim();
  if (v) addQty(v, 1);
};

document.getElementById("btnAdd5").onclick = () => {
  const v = manualBarcode.value.trim();
  if (v) addQty(v, 5);
};

document.getElementById("btnAdd10").onclick = () => {
  const v = manualBarcode.value.trim();
  if (v) addQty(v, 10);
};

document.getElementById("btnAddCustom").onclick = () => {
  const v = manualBarcode.value.trim();
  if (!v) return;
  dlgCode.textContent = v;
  qtyInput.value = "";
  qtyDialog.showModal();
};

dlgOk.onclick = () => {
  const qty = parseInt(qtyInput.value, 10);
  if (qty > 0) addQty(dlgCode.textContent, qty);
  qtyDialog.close();
};

document.getElementById("btnClear").onclick = () => {
  if (!confirm("確定清空？")) return;
  for (const k in inventory) delete inventory[k];
  render();
};

document.getElementById("btnExport").onclick = () => {
  let csv = "barcode,qty\n";
  for (const k in inventory) csv += `${k},${inventory[k]}\n`;

  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "inventory.csv";
  a.click();
};
