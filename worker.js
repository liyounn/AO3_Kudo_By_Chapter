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
 *   GET  /dashboard/:workId/history    → daily vote history (requires secret key)
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

const kudosKey      = (w, c)      => `kudos:${w}:${c}`;
const voterKey      = (w, c, h)   => `voter:${w}:${c}:${h}`;
const indexKey      = (w)         => `index:${w}`;
const rateLimitKey  = (ip, slot)  => `rl:${ip}:${slot}`;
const dailyKey      = (w, date)   => `daily:${w}:${date}`;
const dateIndexKey  = (w)         => `dateindex:${w}`;

const RATE_LIMIT = 60;

async function isRateLimited(request, env) {
  const ip = request.headers.get('CF-Connecting-IP')
          || request.headers.get('X-Forwarded-For')
          || '';
  if (!ip) return false;

  const now  = new Date();
  const slot = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`;
  const key  = rateLimitKey(ip, slot);

  const current = await env.KUDOS_KV.get(key);
  const count   = current ? parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT) return true;

  await env.KUDOS_KV.put(key, String(count + 1), { expirationTtl: 7200 });
  return false;
}

const MAX_HISTORY_DAYS = 90;

function todayUtc() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function recordDailyVote(workId, env) {
  const date   = todayUtc();
  const dKey   = dailyKey(workId, date);
  const diKey  = dateIndexKey(workId);

  const cur = await env.KUDOS_KV.get(dKey);
  await env.KUDOS_KV.put(dKey, String((cur ? parseInt(cur, 10) : 0) + 1), {
    expirationTtl: 60 * 60 * 24 * (MAX_HISTORY_DAYS + 5),
  });

  const raw   = await env.KUDOS_KV.get(diKey);
  const dates = raw ? JSON.parse(raw) : [];
  if (!dates.includes(date)) {
    dates.push(date);
    dates.sort();
    if (dates.length > MAX_HISTORY_DAYS) dates.splice(0, dates.length - MAX_HISTORY_DAYS);
    await env.KUDOS_KV.put(diKey, JSON.stringify(dates));
  }
}

async function handleGetKudos(workId, env, origin) {
  const raw = await env.KUDOS_KV.get(indexKey(workId));
  if (!raw) return json({ workId, chapters: {} }, 200, origin);

  const ids    = JSON.parse(raw);
  const counts = {};
  await Promise.all(ids.map(async id => {
    const val  = await env.KUDOS_KV.get(kudosKey(workId, id));
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

  if (await isRateLimited(request, env)) {
    return error('Rate limit exceeded — try again later', 429, origin);
  }

  const vKey         = voterKey(workId, chapterId, hash);
  const alreadyVoted = await env.KUDOS_KV.get(vKey);
  if (alreadyVoted) return json({ success: false, reason: 'already_voted' }, 200, origin);

  const kKey     = kudosKey(workId, chapterId);
  const current  = await env.KUDOS_KV.get(kKey);
  const newCount = (current ? parseInt(current, 10) : 0) + 1;

  const idxRaw       = await env.KUDOS_KV.get(indexKey(workId));
  const index        = idxRaw ? JSON.parse(idxRaw) : [];
  const indexChanged = !index.includes(chapterId);
  if (indexChanged) index.push(chapterId);

  await Promise.all([
    env.KUDOS_KV.put(kKey, String(newCount)),
    env.KUDOS_KV.put(vKey, '1', { expirationTtl: 60 * 60 * 24 * 365 * 10 }),
    indexChanged ? env.KUDOS_KV.put(indexKey(workId), JSON.stringify(index)) : Promise.resolve(),
    recordDailyVote(workId, env),
  ]);

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

async function handleDashboardHistory(workId, request, env, origin) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key || key !== env.WRITER_SECRET) return error('Unauthorised', 401, origin);

  const diKey = dateIndexKey(workId);
  const raw   = await env.KUDOS_KV.get(diKey);
  if (!raw) return json({ workId, daily: [] }, 200, origin);

  const dates = JSON.parse(raw);
  const daily = [];

  await Promise.all(dates.map(async date => {
    const val   = await env.KUDOS_KV.get(dailyKey(workId, date));
    const count = val ? parseInt(val, 10) : 0;
    daily.push({ date, count });
  }));

  daily.sort((a, b) => a.date.localeCompare(b.date));
  return json({ workId, daily }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || CORS_ORIGIN;
    const path   = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (path === '/bookmarklet.js') {
      const code = bookmarkletLoader.replace('WORKER_BASE_URL', url.origin);
      return js(code, origin);
    }

    if (path === '/kudos-core.js')       return js(kudosCoreJs, origin);
    if (path === '/storage-adapters.js') return js(storageAdaptersJs, origin);

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

    const kudosGet  = path.match(/^\/kudos\/(\d+)$/);
    const kudosPost = path.match(/^\/kudos\/(\d+)\/([\w-]+)$/);
    const dashData  = path.match(/^\/dashboard\/(\d+)$/);
    const dashHist  = path.match(/^\/dashboard\/(\d+)\/history$/);

    if (request.method === 'GET'  && kudosGet)  return handleGetKudos(kudosGet[1], env, origin);
    if (request.method === 'POST' && kudosPost)  return handlePostKudos(kudosPost[1], kudosPost[2], request, env, origin);
    if (request.method === 'GET'  && dashHist)   return handleDashboardHistory(dashHist[1], request, env, origin);
    if (request.method === 'GET'  && dashData)   return handleDashboardData(dashData[1], request, env, origin);

    return error('Not found', 404, origin);
  },
};