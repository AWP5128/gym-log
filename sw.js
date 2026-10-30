// Lets Gym Log open with no signal. Files are fetched fresh when the network answers
// (so updates arrive straight away) and the saved copy is used when it does not.
const CACHE = "gymlog-v1";
const FILES = [
  "./", "./index.html", "./exercises.js", "./settings.js", "./defaults.js", "./log.js", "./timer.js",
  "./extras.js", "./stacks.js","./store.js", "./backup.js", 
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
];
const WAIT_MS = 2000;   // on a weak signal, use the saved copy after this long

self.addEventListener("install", (e) => {
  // Each file on its own, so one missing file cannot stop the rest being saved.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(new Promise((resolve) => {
    const timer = setTimeout(() => caches.match(req).then((hit) => { if (hit) resolve(hit); }), WAIT_MS);
    fetch(req.url, { cache: "no-cache" })
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        resolve(res);
      })
      .catch(() => {
        clearTimeout(timer);
        caches.match(req).then((hit) => resolve(hit || Response.error()));
      });
  }));
});