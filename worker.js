const corsHeaders = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Flash-ID',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
});

function response(body, status, env, extra = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json; charset=utf-8', ...extra }
  });
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function getAuth(request) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+([a-f0-9]{64})$/i);
  const accountId = (request.headers.get('X-Flash-ID') || '').trim().toUpperCase();
  if (!match || !/^FLASH-[A-Z0-9-]{5,40}$/.test(accountId)) return null;
  const token = match[1].toLowerCase();
  // FS2 IDs are FLASH- plus the first 24 hex chars of SHA-256(secret bytes).
  // This blocks a stranger from pre-registering a new-format public ID with an unrelated token.
  if (/^FLASH-[A-F0-9]{24}$/.test(accountId) && accountId !== ('FLASH-' + token.slice(0, 24)).toUpperCase()) return null;
  return { token, accountId };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });

    const url = new URL(request.url);
    if (url.pathname !== '/v1/snapshot') return response({ error: 'Not found' }, 404, env);
    if (request.method !== 'GET' && request.method !== 'PUT') {
      return response({ error: 'Method not allowed' }, 405, env, { Allow: 'GET, PUT, OPTIONS' });
    }

    const auth = getAuth(request);
    if (!auth) return response({ error: 'Missing or invalid account credentials' }, 401, env);
    const tokenHash = await sha256Hex(auth.token);

    if (request.method === 'GET') {
      const row = await env.FLASHSHARE.prepare(
        'SELECT token_hash, iv, ciphertext, updated_at FROM account_snapshots WHERE account_id = ?'
      ).bind(auth.accountId).first();
      if (!row) return response({ error: 'No cloud backup exists yet' }, 404, env);
      if (row.token_hash !== tokenHash) return response({ error: 'Invalid account credentials' }, 401, env);
      return response({ iv: row.iv, ciphertext: row.ciphertext, updatedAt: row.updated_at }, 200, env, {
        'Cache-Control': 'no-store'
      });
    }

    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > 6 * 1024 * 1024) return response({ error: 'Snapshot is too large (6 MB maximum)' }, 413, env);

    let body;
    try { body = await request.json(); }
    catch { return response({ error: 'Request body must be valid JSON' }, 400, env); }

    if (!body || typeof body.iv !== 'string' || typeof body.ciphertext !== 'string') {
      return response({ error: 'Encrypted snapshot requires iv and ciphertext fields' }, 400, env);
    }
    if (!/^[A-Za-z0-9+/]{16}$/.test(body.iv) || body.ciphertext.length < 24 || !/^[A-Za-z0-9+/]+=*$/.test(body.ciphertext)) {
      return response({ error: 'Invalid encrypted snapshot format' }, 400, env);
    }
    if (body.ciphertext.length > 6 * 1024 * 1024) return response({ error: 'Snapshot is too large (6 MB maximum)' }, 413, env);

    const existing = await env.FLASHSHARE.prepare(
      'SELECT token_hash FROM account_snapshots WHERE account_id = ?'
    ).bind(auth.accountId).first();
    if (existing && existing.token_hash !== tokenHash) {
      return response({ error: 'Invalid account credentials' }, 401, env);
    }

    const now = Date.now();
    await env.FLASHSHARE.prepare(`
      INSERT INTO account_snapshots (account_id, token_hash, iv, ciphertext, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        iv = excluded.iv,
        ciphertext = excluded.ciphertext,
        updated_at = excluded.updated_at
    `).bind(auth.accountId, tokenHash, body.iv, body.ciphertext, now).run();

    return response({ ok: true, updatedAt: now }, 200, env, { 'Cache-Control': 'no-store' });
  }
};
