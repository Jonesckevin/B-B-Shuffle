/**
 * B&B Shuffle - service worker (PWA app shell)
 *
 * Scope: the repo root (this file's own directory), so it controls the portal
 * and every Engine-V2 page. It exists to make the app installable and to serve
 * the shell when offline - NOT to freeze the app in time, so the freshness
 * rules matter:
 *
 *   - Navigations and HTML/JS/CSS: NETWORK-FIRST. A redeploy is picked up on
 *     the next load; the cache is only a fallback when the network fails.
 *   - Static art/icons/fonts: CACHE-FIRST, refreshed in the background.
 *   - /api/*          : never touched (the backend must always be live).
 *   - /Engine-V2/modules/* : never touched (Mermaid / AI Generator are out of
 *     scope for the shell; let the browser handle them normally).
 *   - Requests made with cache:'no-store' (the static fork's local-api.js) are
 *     passed straight through, so the demo's fresh-fetch behaviour survives.
 *
 * Bump VERSION to invalidate every cache on the next visit.
 */
'use strict';

const VERSION = 'bb-shuffle-v3';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

// The offline shell. Kept to files that exist in BOTH the main repo and the
// static fork; everything else is cached on first use at runtime. Added
// individually so a single 404 cannot abort the install.
const SHELL = [
  './',
  'index.html',
  'Engine-V2/player.html',
  'Engine-V2/css/player.css',
  'shared/css/base.css',
  'shared/js/fab.js',
  'shared/js/pwa.js',
  'Engine-V2/js/utils.js',
  'Engine-V2/js/config.js',
  'Engine-V2/js/game-state.js',
  'Engine-V2/js/player.js',
  'Engine-V2/js/header-menu.js',
  'Engine-V2/js/landscape-controls.js',
  'Engine-V2/js/cardback-theme.js',
  'manifest.webmanifest',
  'shared/img/favicon.ico',
  'shared/img/favicon.png',
  'shared/img/pwa-192.png',
  'shared/img/pwa-512.png',
  'shared/img/pwa-maskable-512.png',
  'shared/img/apple-touch-icon.png'
];

// Static asset types that are safe to serve from cache first.
const ASSET_RE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf)$/i;

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(async function (url) {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (_) {
        /* a missing shell file must not block install */
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(function (key) { return key.indexOf(VERSION) !== 0; })
      .map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
  })());
});

function bypass(url, request) {
  if (url.origin !== self.location.origin) return true;
  if (request.cache === 'no-store') return true;
  if (url.pathname.indexOf('/api/') !== -1) return true;
  if (url.pathname.indexOf('/Engine-V2/modules/') !== -1) return true;
  return false;
}

async function putIn(cacheName, request, response) {
  if (!response || !response.ok) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (_) { /* opaque / already-consumed - ignore */ }
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (bypass(url, request)) return;   // fall through to the network

  // Navigations: network-first, cached document as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith((async function () {
      try {
        const fresh = await fetch(request);
        await putIn(RUNTIME_CACHE, request, fresh);
        return fresh;
      } catch (_) {
        return (await caches.match(request))
          || (await caches.match('Engine-V2/player.html'))
          || (await caches.match('index.html'))
          || Response.error();
      }
    })());
    return;
  }

  // Static art/icons/fonts: cache-first, refresh in the background.
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith((async function () {
      const cached = await caches.match(request);
      if (cached) {
        fetch(request).then(function (res) {
          return putIn(RUNTIME_CACHE, request, res);
        }).catch(function () {});
        return cached;
      }
      const fresh = await fetch(request);
      await putIn(RUNTIME_CACHE, request, fresh);
      return fresh;
    })());
    return;
  }

  // HTML (non-navigation), JS, CSS, JSON: network-first, cache as fallback.
  event.respondWith((async function () {
    try {
      const fresh = await fetch(request);
      await putIn(RUNTIME_CACHE, request, fresh);
      return fresh;
    } catch (err) {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw err;
    }
  })());
});
