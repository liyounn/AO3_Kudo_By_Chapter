/**
 * AO3 Chapter Kudos — storage-adapters.js
 * ─────────────────────────────────────────
 * Two adapters with identical interfaces:
 *   - chromeStorageAdapter  → used by the browser extension
 *   - localStorageAdapter   → used by the bookmarklet
 *
 * Both expose:
 *   getVoteHistory()                          → Promise<{ "workId:chapterId": true }>
 *   saveVote(workId, chapterId, meta)         → Promise<void>
 *   getDeviceId()                             → Promise<string>
 */

// ── Chrome Storage Adapter (extension) ───────────────────────────────────────
window.chromeStorageAdapter = {
  getVoteHistory() {
    return new Promise(resolve => {
      chrome.storage.local.get(['voteHistory'], r => resolve(r.voteHistory || {}));
    });
  },

  saveVote(workId, chapterId, meta) {
    return new Promise(resolve => {
      chrome.storage.local.get(['voteHistory', 'recentVotes'], r => {
        const history = r.voteHistory  || {};
        const recent  = r.recentVotes  || [];

        history[`${workId}:${chapterId}`] = true;

        recent.unshift({
          workId,
          chapterId,
          url:   meta.url,
          title: meta.title,
          ts:    Date.now(),
        });

        chrome.storage.local.set({
          voteHistory: history,
          recentVotes: recent.slice(0, 50),
        }, resolve);
      });
    });
  },

  getDeviceId() {
    return new Promise(resolve => {
      chrome.storage.local.get(['deviceId'], r => {
        if (r.deviceId) return resolve(r.deviceId);
        const id = crypto.randomUUID();
        chrome.storage.local.set({ deviceId: id }, () => resolve(id));
      });
    });
  },
};

// ── localStorage Adapter (bookmarklet) ───────────────────────────────────────
window.localStorageAdapter = {
  getVoteHistory() {
    try {
      const raw = localStorage.getItem('ck_voteHistory');
      return Promise.resolve(raw ? JSON.parse(raw) : {});
    } catch {
      return Promise.resolve({});
    }
  },

  saveVote(workId, chapterId, meta) {
    try {
      const hRaw   = localStorage.getItem('ck_voteHistory');
      const history = hRaw ? JSON.parse(hRaw) : {};
      history[`${workId}:${chapterId}`] = true;
      localStorage.setItem('ck_voteHistory', JSON.stringify(history));

      const rRaw  = localStorage.getItem('ck_recentVotes');
      const recent = rRaw ? JSON.parse(rRaw) : [];
      recent.unshift({ workId, chapterId, url: meta.url, title: meta.title, ts: Date.now() });
      localStorage.setItem('ck_recentVotes', JSON.stringify(recent.slice(0, 50)));
    } catch {}
    return Promise.resolve();
  },

  getDeviceId() {
    try {
      let id = localStorage.getItem('ck_deviceId');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('ck_deviceId', id);
      }
      return Promise.resolve(id);
    } catch {
      return Promise.resolve('anonymous');
    }
  },
};
