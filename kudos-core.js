/**
 * AO3 Chapter Kudos — kudos-core.js
 * ───────────────────────────────────
 * Shared logic used by both the browser extension (content.js)
 * and the bookmarklet. Do not call directly — use via one of those
 * two entry points, which provide the correct storage adapter.
 *
 * Expected globals before this file runs:
 *   window.__ckStorage  — storage adapter (see storage-adapters.js)
 *   window.__ckMode     — 'extension' | 'bookmarklet'
 */

(function () {
  'use strict';

  // Guard: don't run twice on the same page
  if (window.__ckInitialised) return;
  window.__ckInitialised = true;

  const storage = window.__ckStorage;
  const mode    = window.__ckMode || 'bookmarklet';

  // ── Step 1: Discover endpoint ──────────────────────────────────────────────
  const endpoint = discoverEndpoint();
  if (!endpoint) {
    if (mode === 'bookmarklet') {
      // Bookmarklet tapped on a work with no skin — tell the reader why
      showToast('No Chapter Kudos skin found on this work.');
    }
    return;
  }

  // ── Step 2: Extract work ID ────────────────────────────────────────────────
  const workId = extractWorkId();
  if (!workId) return;

  // ── Step 3: Run ────────────────────────────────────────────────────────────
  injectStyles();
  init();

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint Discovery
  // ═══════════════════════════════════════════════════════════════════════════

  function discoverEndpoint() {
    try {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--ck-endpoint')
        .trim()
        .replace(/['"]/g, '');

      if (!raw) return null;

      const url = new URL(raw);
      if (url.protocol !== 'https:') return null;

      return url.origin + url.pathname.replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Page Parsing
  // ═══════════════════════════════════════════════════════════════════════════

  function extractWorkId() {
    const m = location.pathname.match(/\/works\/(\d+)/);
    return m ? m[1] : null;
  }

  function extractUsername() {
    const el = document.querySelector(
      'ul.primary.navigation li.userstuff a[href^="/users/"]'
    );
    return el ? el.textContent.trim() : null;
  }

  function findChapters() {
    // Full-work view: multiple div[id^="chapter-"] on one page
    const fullWork = document.querySelectorAll('div[id^="chapter-"]');
    if (fullWork.length > 0) {
      return Array.from(fullWork).map(el => ({
        el,
        chapterId: el.id.replace('chapter-', ''),
      }));
    }

    // Single chapter per page: ID in URL
    const urlMatch  = location.pathname.match(/\/chapters\/(\d+)/);
    const chapterEl = document.querySelector('#chapters');
    if (chapterEl && urlMatch) {
      return [{ el: chapterEl, chapterId: urlMatch[1] }];
    }

    // One-shot work: no chapter structure
    const prose = document.querySelector('#workskin, .userstuff');
    if (prose) {
      return [{ el: prose, chapterId: 'main' }];
    }

    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════════════════════════════════

  async function init() {
    const chapters = findChapters();
    if (chapters.length === 0) return;

    const username     = extractUsername();
    const usernameHash = username ? await hashString(`${username}:${workId}:ao3-ck`) : null;
    const counts       = await fetchCounts();
    const voteHistory  = await storage.getVoteHistory();

    chapters.forEach(({ el, chapterId }, index) => {
      const count    = counts[chapterId] ?? 0;
      const hasVoted = voteHistory[`${workId}:${chapterId}`] ?? false;
      injectWidget(el, chapterId, index + 1, count, hasVoted, usernameHash);
    });

    ensureToast();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Network
  // ═══════════════════════════════════════════════════════════════════════════

  async function fetchCounts() {
    try {
      const res = await fetch(`${endpoint}/kudos/${workId}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return {};
      const data = await res.json();
      return data.chapters || {};
    } catch {
      return {};
    }
  }

  async function postKudos(chapterId, usernameHash) {
    const hash = usernameHash || await storage.getDeviceId();
    try {
      const res = await fetch(`${endpoint}/kudos/${workId}/${chapterId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Username-Hash': hash,
        },
      });
      if (!res.ok) return { success: false, reason: 'server_error' };
      return await res.json();
    } catch {
      return { success: false, reason: 'network_error' };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Widget
  // ═══════════════════════════════════════════════════════════════════════════

  function injectWidget(chapterEl, chapterId, chapterNumber, initialCount, hasVoted, usernameHash) {
    const anchor = chapterEl.querySelector('.chapter-end-notes, .end.notes') || chapterEl;

    const wrap  = document.createElement('div');
    wrap.className = 'ck-wrap';
    wrap.setAttribute('data-chapter-id', chapterId);

    const label = document.createElement('div');
    label.className   = 'ck-label';
    label.textContent = `Chapter ${chapterNumber}`;

    const row = document.createElement('div');
    row.className = 'ck-row';

    const btn = document.createElement('button');
    btn.className = 'ck-btn' + (hasVoted ? ' ck-btn--given' : '');
    btn.disabled  = hasVoted;
    btn.innerHTML = `
      <span class="ck-heart">${hasVoted ? '♥' : '♡'}</span>
      <span class="ck-btn-text">${hasVoted ? 'Kudos given!' : 'Give kudos'}</span>
    `;
    btn.setAttribute('aria-label',
      hasVoted
        ? `You already gave kudos to chapter ${chapterNumber}`
        : `Give kudos to chapter ${chapterNumber}`
    );

    const countEl = document.createElement('span');
    countEl.className = 'ck-count';
    renderCount(countEl, initialCount);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.classList.add('ck-btn--loading');
      btn.querySelector('.ck-btn-text').textContent = 'Sending…';

      const result = await postKudos(chapterId, usernameHash);
      btn.classList.remove('ck-btn--loading');

      if (result.success) {
        btn.classList.add('ck-btn--given');
        btn.querySelector('.ck-heart').textContent    = '♥';
        btn.querySelector('.ck-btn-text').textContent = 'Kudos given!';
        renderCount(countEl, result.count);
        await storage.saveVote(workId, chapterId, {
          url: location.href,
          title: document.title,
        });
        burst(btn);
        showToast(`♥ Kudos left on chapter ${chapterNumber}!`);
      } else if (result.reason === 'already_voted') {
        btn.classList.add('ck-btn--given');
        btn.querySelector('.ck-heart').textContent    = '♥';
        btn.querySelector('.ck-btn-text').textContent = 'Kudos given!';
        await storage.saveVote(workId, chapterId, {
          url: location.href,
          title: document.title,
        });
      } else {
        btn.disabled = false;
        btn.querySelector('.ck-btn-text').textContent = 'Try again';
        showToast('Something went wrong — please try again.');
      }
    });

    row.appendChild(btn);
    row.appendChild(countEl);
    wrap.appendChild(label);
    wrap.appendChild(row);
    anchor.insertAdjacentElement('afterend', wrap);
  }

  function renderCount(el, count) {
    el.innerHTML = `<span class="ck-count-num">${count}</span> `
                 + `reader${count !== 1 ? 's' : ''} loved this chapter`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  async function hashString(str) {
    const buf   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function ensureToast() {
    if (!document.getElementById('ck-toast')) {
      const t = document.createElement('div');
      t.id        = 'ck-toast';
      t.className = 'ck-toast';
      document.body.appendChild(t);
    }
  }

  function showToast(msg) {
    ensureToast();
    const t = document.getElementById('ck-toast');
    t.textContent = msg;
    t.classList.add('ck-toast--show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('ck-toast--show'), 2600);
  }

  function burst(btn) {
    const rect = btn.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2 + window.scrollX;
    const cy   = rect.top  + rect.height / 2 + window.scrollY;
    for (let i = 0; i < 8; i++) {
      const p     = document.createElement('div');
      p.className = 'ck-particle';
      const angle = (i / 8) * Math.PI * 2;
      const dist  = 30 + Math.random() * 20;
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.left = `${cx - 4}px`;
      p.style.top  = `${cy - 4}px`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 650);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Style injection (bookmarklet only — extension uses content.css)
  // ═══════════════════════════════════════════════════════════════════════════

  function injectStyles() {
    if (mode !== 'bookmarklet') return;
    if (document.getElementById('ck-styles')) return;

    const style = document.createElement('style');
    style.id = 'ck-styles';
    style.textContent = `
      :root {
        --ck-heart:      #c0392b;
        --ck-heart-glow: rgba(192,57,43,0.3);
        --ck-bg:         #fdf6f0;
        --ck-border:     #d4b8a8;
        --ck-text:       #5a3e36;
        --ck-muted:      #9c7b6e;
        --ck-radius:     12px;
      }
      .ck-wrap {
        display:flex; flex-direction:column; align-items:center; gap:.5rem;
        margin:2rem auto 1rem; padding:1rem 1.4rem 1.1rem;
        max-width:480px; background:var(--ck-bg);
        border:1px solid var(--ck-border); border-radius:var(--ck-radius);
        font-family:Georgia,'Times New Roman',serif;
        box-shadow:0 2px 10px rgba(90,62,54,.07);
        background-image:repeating-linear-gradient(
          -45deg,transparent,transparent 8px,
          rgba(192,57,43,.022) 8px,rgba(192,57,43,.022) 9px);
      }
      .ck-label { font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; color:var(--ck-muted); }
      .ck-row   { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; justify-content:center; }
      .ck-btn {
        display:inline-flex; align-items:center; gap:.45rem;
        padding:.5rem 1.2rem; background:#fff;
        border:1.5px solid var(--ck-border); border-radius:99px;
        font-family:Georgia,serif; font-size:.9rem; color:var(--ck-text);
        cursor:pointer; user-select:none; white-space:nowrap;
        transition:border-color .2s,box-shadow .2s,transform .15s,background .2s;
      }
      .ck-btn:hover:not(:disabled) {
        border-color:var(--ck-heart);
        box-shadow:0 0 0 3px var(--ck-heart-glow);
        transform:translateY(-1px);
      }
      .ck-btn--given  { background:#fff0ee; border-color:var(--ck-heart); color:var(--ck-heart); cursor:default; }
      .ck-btn--loading{ opacity:.7; cursor:wait; }
      .ck-btn:disabled{ cursor:default; }
      .ck-heart { font-size:1.1rem; line-height:1; display:inline-block; }
      .ck-btn--given .ck-heart { animation:ck-heartpop .4s cubic-bezier(.36,.07,.19,.97) both; }
      .ck-count     { font-size:.84rem; color:var(--ck-muted); font-style:italic; }
      .ck-count-num { font-style:normal; font-weight:bold; color:var(--ck-text); }
      .ck-toast {
        position:fixed; bottom:1.8rem; left:50%;
        transform:translateX(-50%) translateY(16px);
        background:#2c1810; color:#fdf6f0;
        font-family:Georgia,serif; font-size:.88rem;
        padding:.55rem 1.3rem; border-radius:99px;
        box-shadow:0 4px 20px rgba(44,24,16,.22);
        opacity:0; pointer-events:none;
        transition:opacity .28s,transform .28s;
        z-index:99999; white-space:nowrap;
      }
      .ck-toast--show { opacity:1; transform:translateX(-50%) translateY(0); }
      .ck-particle {
        position:absolute; width:8px; height:8px; border-radius:50%;
        background:var(--ck-heart); pointer-events:none; z-index:99998;
        animation:ck-burst .6s ease-out forwards;
      }
      @keyframes ck-heartpop {
        0%{transform:scale(1)} 35%{transform:scale(1.6)}
        65%{transform:scale(.9)} 100%{transform:scale(1.15)}
      }
      @keyframes ck-burst {
        0%  {opacity:1;transform:translate(0,0) scale(1)}
        100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.2)}
      }
    `;
    document.head.appendChild(style);
  }

})();
