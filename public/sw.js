// Jobrx's service worker: shows phone alerts (web push) and opens the app where one leads when it's tapped.
// It caches nothing; the app is always loaded fresh.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "Jobrx" };
  }
  const title = data.title || "Jobrx";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      // The same notification again replaces the one showing rather than stacking.
      tag: data.tag || undefined,
      data: { href: data.href || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = new URL((event.notification.data && event.notification.data.href) || "/app", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // An open Jobrx window goes there; otherwise a new one opens.
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(href).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(href);
    })(),
  );
});
