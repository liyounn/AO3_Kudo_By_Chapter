/**
 * AO3 Chapter Kudos — Extension Entry Point (content.js)
 * ────────────────────────────────────────────────────────
 * Thin wrapper. Sets up the Chrome storage adapter, then
 * delegates everything to kudos-core.js.
 *
 * Both this file and storage-adapters.js are loaded before
 * kudos-core.js via the manifest's content_scripts array.
 */

// Set the adapter and mode before kudos-core.js runs
window.__ckStorage = window.chromeStorageAdapter;
window.__ckMode    = 'extension';

// kudos-core.js runs next (see manifest.json content_scripts order)
