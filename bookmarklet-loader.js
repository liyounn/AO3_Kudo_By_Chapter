/**
 * AO3 Chapter Kudos — bookmarklet-loader.js
 * ───────────────────────────────────────────
 * This file is served by the Worker at GET /bookmarklet.js
 * It is what the reader's bookmarklet actually loads.
 *
 * Execution order:
 *   1. This file loads (sets adapter + mode)
 *   2. Dynamically loads storage-adapters.js
 *   3. Dynamically loads kudos-core.js
 *
 * Since the bookmarklet can be tapped multiple times per session,
 * both guard flags (__ckInitialised, __ckStylesLoaded) prevent
 * duplicate widgets or style tags from being injected.
 */

(function () {
  'use strict';

  const BASE = 'WORKER_BASE_URL'; // Replaced at serve-time by the Worker

  function loadScript(src, onload) {
    const s  = document.createElement('script');
    s.src    = src;
    s.onload = onload;
    document.head.appendChild(s);
  }

  // Load adapters first, then core
  loadScript(`${BASE}/storage-adapters.js`, function () {
    window.__ckStorage = window.localStorageAdapter;
    window.__ckMode    = 'bookmarklet';

    // Reset init guard so tapping the bookmarklet again on a new page works,
    // but NOT if widgets are already present on this page load
    if (!document.querySelector('.ck-wrap')) {
      window.__ckInitialised = false;
    }

    loadScript(`${BASE}/kudos-core.js`);
  });
})();
