const version = "__VERSION__";
const entries = __PRECACHE__;
const scope = self.registration.scope;
const prefix = "audio-mcp-studio:" + scope + ":";
const cacheName = prefix + version;
const url = (p) => new URL(p, scope).href;
self.addEventListener("install", (e) =>
  e.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(cacheName);
        const storeEntry = async ([path, hash]) => {
          const response = await fetch(url(path) + "?v=" + version, { cache: "reload" });
          if (!response.ok) throw Error("Missing release asset");
          const body = await response.arrayBuffer();
          const digest = await crypto.subtle.digest("SHA-256", body);
          const actual = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
          if (actual !== hash) throw Error("Release integrity check failed");
          // Replaying a followed HTML redirect fails on offline navigations. A new
          // response also lets us release each verified bank before reading more.
          const headers = new Headers(response.headers);
          headers.delete("Content-Encoding");
          headers.delete("Content-Length");
          await cache.put(url(path), new Response(body, { headers }));
        };
        for (let i = 0; i < entries.length; i += 2) {
          const batch = await Promise.allSettled(entries.slice(i, i + 2).map(storeEntry));
          const failure = batch.find(result => result.status === "rejected");
          if (failure) throw failure.reason;
        }
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      }
    })(),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((k) => k.startsWith(prefix) && k !== cacheName)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (e) => {
  if (e.data !== "activate-single-tab") return;
  e.waitUntil(
    (async () => {
      const tabs = (
        await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        })
      ).filter((t) => t.url.startsWith(scope));
      if (tabs.length === 1 && tabs[0].id === e.source?.id)
        await self.skipWaiting();
      else e.source?.postMessage("other-tabs");
    })(),
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const target = new URL(e.request.url);
  target.search = "";
  target.hash = "";
  const key = target.href === scope ? url("index.html") : target.href;
  if (!entries.some(([p]) => url(p) === key)) return;
  e.respondWith(
    (async () => {
      const cached = await (await caches.open(cacheName)).match(key);
      return cached || fetch(e.request);
    })(),
  );
});
