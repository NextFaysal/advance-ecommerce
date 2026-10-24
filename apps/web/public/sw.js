/**
 * Service worker — Advance Ecommerce (Agent 12, Step 30 base).
 *
 * Offline shell ONLY. No push handlers, no secrets, no API caching.
 * Keep CACHE_VERSION and the cache names in sync with
 * apps/web/src/pwa/config.ts.
 *
 * Strategies:
 *  - Static assets (/_next/static, /icons, fonts, images, manifest):
 *    cache-first, then network (and cache the response).
 *  - Page navigations: network-first, fall back to the page cache,
 *    then to the precached /offline page.
 *  - Everything else (including ALL /api/* and /admin/login):
 *    network only — never intercepted into a cache.
 */
"use strict";

var CACHE_VERSION = "v1";
var STATIC_CACHE = "advance-ecommerce-static-" + CACHE_VERSION;
var PAGE_CACHE = "advance-ecommerce-pages-" + CACHE_VERSION;
var OFFLINE_URL = "/offline";
var PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest"];

var STATIC_PATH_PREFIXES = ["/_next/static/", "/icons/", "/fonts/"];
var STATIC_FILE_RE = /\.(?:css|js|png|jpg|jpeg|webp|avif|svg|ico|woff2?|ttf|webmanifest)$/;

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then(function (cache) {
        return cache.addAll(PRECACHE_URLS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== STATIC_CACHE && key !== PAGE_CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function isStaticAsset(url) {
  for (var i = 0; i < STATIC_PATH_PREFIXES.length; i += 1) {
    if (url.pathname.indexOf(STATIC_PATH_PREFIXES[i]) === 0) return true;
  }
  return STATIC_FILE_RE.test(url.pathname);
}

function isNeverCache(url) {
  return url.pathname.indexOf("/api/") === 0 || url.pathname === "/admin/login";
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCache(url)) return; // Network only.

  // Page navigations: network-first, page-cache fallback, offline page last.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          var copy = response.clone();
          caches.open(PAGE_CACHE).then(function (cache) {
            return cache.put(request, copy);
          });
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || caches.match(OFFLINE_URL);
          });
        })
    );
    return;
  }

  // Static assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (response) {
          if (response && response.status === 200) {
            var copy = response.clone();
            caches.open(STATIC_CACHE).then(function (cache) {
              return cache.put(request, copy);
            });
          }
          return response;
        });
      })
    );
  }
});

// Push notifications are intentionally NOT handled in this base worker.
// A push slice must add its own handler later and must never put order,
// payment, or credential data in a notification payload handled here.
