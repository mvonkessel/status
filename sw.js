// ══════════════════════════════════════════════════════════════════
// Service Worker — Network-First für index.html
//
// Warum die Strategie: cache-first für die Haupt-HTML stuckt User auf alten
// Versionen bis der SW selbst updated. Wir wollen aber SOFORT die neueste
// Version sehen (auch ohne "Hard Refresh" o.ä.). Daher:
//
//   • index.html → NETWORK-FIRST mit Cache-Fallback (offline trotzdem nutzbar)
//   • Firebase SDKs / Fonts → cache-first (sind versioniert via URL, ändern nie)
//   • Andere Assets → cache-first (icons, manifest)
//
// Plus: skipWaiting + clients.claim → Update aktiviert sich SOFORT bei nächstem
// Page-Load, nicht erst beim ÜBERnächsten. clientside detect über
// 'controllerchange' triggert auto-reload.
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME = 'status-v38';
const ASSETS = ['./manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── Strategy A: Firebase SDK / Fonts / Google APIs → stale-while-revalidate ──
  // Diese URLs sind versioniert (10.14.0/firebase-app-compat.js) und ändern
  // sich nicht ohne URL-Change → Cache-Hit ist immer korrekt, Background-Fetch
  // hält die nächste Variante warm.
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          const fetching = fetch(e.request).then(response => {
            if (response.ok) cache.put(e.request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetching;
        })
      )
    );
    return;
  }

  // ── Strategy B: index.html (Navigation) → NETWORK-FIRST ──
  // GitHub Pages hat schnelle CDN-Antworten; wenn online, sehen wir SOFORT die
  // neueste deployte Version. Wenn offline (kein Netz), Cache-Fallback damit
  // die App grundsätzlich nutzbar bleibt. Das fixt das "Cache stuck auf alter
  // Version"-Problem das Wiebke gerade hatte.
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(e.request).then(response => {
        // Cache the fresh copy für Offline-Fallback
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // ── Strategy C: Andere Assets → cache-first ──
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

// Notification clicks
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('./index.html');
      }
    })
  );
});

// FCM push messages für Wiebke
self.addEventListener('push', e => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch (err) {
    try { payload = { data: { title: 'Timer7', body: e.data.text() } }; } catch (e2) { return; }
  }
  const d = (payload.data || payload.notification || payload) || {};
  const title = d.title || 'Moritz Status';
  const body = d.body || '';
  const tag = d.tag || 'wiebke-push';
  let vibrate = [300, 80, 300];
  try { if (d.vibrate) vibrate = JSON.parse(d.vibrate); } catch (e) {}

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag,
      renotify: true,
      vibrate,
      silent: false,
      actions: [{ action: 'open', title: '▶ Öffnen' }]
    })
  );
});
