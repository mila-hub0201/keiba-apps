// sw.js — オフライン対応のためのサービスワーカー。
// アプリ本体は事前キャッシュ、cMap等の大きな資材は初回利用時にキャッシュする。

const CACHE = "umafull-v1";
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/pipeline.js",
  "./js/extract.js",
  "./js/comments.js",
  "./vendor/pdfjs/pdf.min.mjs",
  "./vendor/pdfjs/pdf.worker.min.mjs",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./demo/entries.jsonl",
  "./demo/race.md",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Android の共有メニューから受け取ったPDFを一時キャッシュに置き、
// アプリ本体(?share-target=1)にリダイレクトして渡す
const SHARE_CACHE = "umafull-share";

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      try {
        const formData = await e.request.formData();
        const file = formData.get("pdf");
        const cache = await caches.open(SHARE_CACHE);
        if (file && file.size > 0) {
          await cache.put("shared-pdf",
            new Response(file, { headers: { "Content-Type": "application/pdf" } }));
        } else {
          // PDFファイルではなくURL/テキストだけ共有されたケースの目印
          await cache.put("shared-miss", new Response("1"));
        }
      } catch { /* 受け取れなくてもアプリは開く */ }
      return Response.redirect(new URL("./?share-target=1", self.registration.scope), 303);
    })());
    return;
  }
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => cached ?? Response.error()))
  );
});
