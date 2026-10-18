self.addEventListener(
  'install',
  () => self.skipWaiting()
);

self.addEventListener(
  'activate',
  event => {
    event.waitUntil(
      self.clients.claim()
    );
  }
);

// 目前只有 PWA 基礎註冊，
// 尚未實作離線快取及背景推播。
self.addEventListener(
  'fetch',
  () => {}
);
