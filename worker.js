/**
 * AO3 Chapter Kudos — Cloudflare Worker
 * ──────────────────────────────────────
 * Endpoints:
 *   GET  /                              → writer dashboard UI
 *   GET  /bookmarklet.js               → bookmarklet loader (readers)
 *   GET  /bookmarklet-install          → bookmarklet install guide page
 *   GET  /kudos-core.js                → shared core logic
 *   GET  /storage-adapters.js          → storage adapters
 *   GET  /kudos/:workId                → all chapter counts for a work
 *   POST /kudos/:workId/:chapterId     → increment a chapter's count
 *   GET  /dashboard/:workId            → writer analytics (requires secret key)
 *
 * KV Namespaces:  KUDOS_KV
 * Environment:    WRITER_SECRET
 */

import dashboardHtml      from './dashboard.html';
import installHtml        from './install.html';
import kudosCoreJs        from './kudos-core.js';
import storageAdaptersJs  from './storage-adapters.js';
import bookmarkletLoader  from './bookmarklet-loader.js';

const CORS_ORIGIN = 'https://archiveofourown.org';

// ── CORS ──────────────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  const allowed = [CORS_ORIGIN, 'null'];
  const use     = allowed.includes(origin) ? origin : CORS_ORIGIN;
  return {
    'Access-Control-Allow-Origin':  use,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Username-Hash',
    'Access-Control-Max-Age':       '86400',
  };
}

function json(data, status = 200, origin = CORS_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function error(msg, status = 400, origin = CORS_ORIGIN) {
  return json({ error: msg }, status, origin);
}

function js(code, origin) {
  return new Response(code, {
    headers: {
      'Content-Type':  'application/javascript',
      'Cache-Control': 'no-cache',
      ...corsHeaders(origin),
    },
  });
}

// ── KV helpers ────────────────────────────────────────────────────────────────
const kudosKey = (w, c)      => `kudos:${w}:${c}`;
const voterKey = (w, c, h)   => `voter:${w}:${c}:${h}`;
const indexKey = (w)         => `index:${w}`;

// ── Handlers ──────────────────────────────────────────────────────────────────
async function handleGetKudos(workId, env, origin) {
  const raw = await env.KUDOS_KV.get(indexKey(workId));
  if (!raw) return json({ workId, chapters: {} }, 200, origin);

  const ids    = JSON.parse(raw);
  const counts = {};
  await Promise.all(ids.map(async id => {
    const val      = await env.KUDOS_KV.get(kudosKey(workId, id));
    counts[id] = val ? parseInt(val, 10) : 0;
  }));

  return json({ workId, chapters: counts }, 200, origin);
}

async function handlePostKudos(workId, chapterId, request, env, origin) {
  if (!/^\d+$/.test(workId) || !/^[\w-]+$/.test(chapterId)) {
    return error('Invalid IDs', 400, origin);
  }

  const hash = request.headers.get('X-Username-Hash') || '';
  if (!hash || hash.length < 8) return error('Missing voter identity', 400, origin);

  const vKey        = voterKey(workId, chapterId, hash);
  const alreadyVoted = await env.KUDOS_KV.get(vKey);
  if (alreadyVoted) return json({ success: false, reason: 'already_voted' }, 200, origin);

  const kKey    = kudosKey(workId, chapterId);
  const current = await env.KUDOS_KV.get(kKey);
  const newCount = (current ? parseInt(current, 10) : 0) + 1;
  await env.KUDOS_KV.put(kKey, String(newCount));
  await env.KUDOS_KV.put(vKey, '1', { expirationTtl: 60 * 60 * 24 * 365 * 10 });

  // Update index
  const idxRaw = await env.KUDOS_KV.get(indexKey(workId));
  const index  = idxRaw ? JSON.parse(idxRaw) : [];
  if (!index.includes(chapterId)) {
    index.push(chapterId);
    await env.KUDOS_KV.put(indexKey(workId), JSON.stringify(index));
  }

  return json({ success: true, count: newCount }, 200, origin);
}

async function handleDashboardData(workId, request, env, origin) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key || key !== env.WRITER_SECRET) return error('Unauthorised', 401, origin);

  const raw = await env.KUDOS_KV.get(indexKey(workId));
  if (!raw) return json({ workId, chapters: [], total: 0 }, 200, origin);

  const ids      = JSON.parse(raw);
  const chapters = [];
  let total      = 0;

  await Promise.all(ids.map(async id => {
    const val   = await env.KUDOS_KV.get(kudosKey(workId, id));
    const count = val ? parseInt(val, 10) : 0;
    total += count;
    chapters.push({ chapterId: id, count });
  }));

  chapters.sort((a, b) => ids.indexOf(a.chapterId) - ids.indexOf(b.chapterId));
  return json({ workId, chapters, total }, 200, origin);
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || CORS_ORIGIN;
    const path   = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ── Static JS files ──
    if (path === '/bookmarklet.js') {
      // Inject the worker's own base URL so the loader knows where to fetch core from
      const code = bookmarkletLoader.replace('WORKER_BASE_URL', url.origin);
      return js(code, origin);
    }

    if (path === '/kudos-core.js')       return js(kudosCoreJs, origin);
    if (path === '/storage-adapters.js') return js(storageAdaptersJs, origin);

    // ── HTML pages ──
    if (path === '/' || path === '/dashboard') {
      return new Response(dashboardHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (path === '/bookmarklet-install') {
      return new Response(installHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // ── API ──
    const kudosGet  = path.match(/^\/kudos\/(\d+)$/);
    const kudosPost = path.match(/^\/kudos\/(\d+)\/([\w-]+)$/);
    const dashData  = path.match(/^\/dashboard\/(\d+)$/);

    if (request.method === 'GET'  && kudosGet)  return handleGetKudos(kudosGet[1], env, origin);
    if (request.method === 'POST' && kudosPost)  return handlePostKudos(kudosPost[1], kudosPost[2], request, env, origin);
    if (request.method === 'GET'  && dashData)   return handleDashboardData(dashData[1], request, env, origin);

    return error('Not found', 404, origin);
  },
};
