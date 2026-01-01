cat > sw.js << 'EOF'
const CACHE="inventory-web-v1"
self.addEventListener("install",e=>{
 e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["./"])))
 self.skipWaiting()
})
self.addEventListener("activate",e=>{
 e.waitUntil(self.clients.claim())
})
EOF
