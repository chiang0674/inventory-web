cat > app.js << 'EOF'
const inventory={}
document.getElementById("btnAdd1").onclick=()=>add(1)
document.getElementById("btnAdd5").onclick=()=>add(5)
document.getElementById("btnAdd10").onclick=()=>add(10)
function add(q){
  const c=document.getElementById("manualBarcode").value.trim()
  if(!c)return
  inventory[c]=(inventory[c]||0)+q
  render()
}
function render(){
  const ul=document.getElementById("list")
  ul.innerHTML=""
  Object.keys(inventory).forEach(k=>{
    const li=document.createElement("li")
    li.textContent=k+" : "+inventory[k]
    ul.appendChild(li)
  })
}
document.getElementById("btnExport").onclick=()=>{
  let csv="barcode,qty\n"
  for(const k in inventory)csv+=k+","+inventory[k]+"\n"
  const a=document.createElement("a")
  a.href=URL.createObjectURL(new Blob([csv]))
  a.download="inventory.csv"
  a.click()
}
if("serviceWorker"in navigator){
 navigator.serviceWorker.register("sw.js")
}
EOF
