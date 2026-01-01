self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// 不做任何快取，永遠走網路最新版本
self.addEventListener("fetch", () => {});
