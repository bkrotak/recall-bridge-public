import { SignJWT, importPKCS8 } from 'jose';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const bearer = (request) => request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
const requireAdmin = (request, env) => bearer(request) === env.BRIDGE_ADMIN_TOKEN;

const sha256 = async (value) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const randomToken = (bytes = 24) => {
  const value = new Uint8Array(bytes); crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replace(/[+/=]/g, '').slice(0, bytes * 4 / 3);
};

async function googleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(env.FIREBASE_CLIENT_EMAIL)
    .setSubject(env.FIREBASE_CLIENT_EMAIL)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).access_token;
}

async function wakeDevice(env, deviceId) {
  const device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(deviceId).first();
  if (!device) throw new Error('Unknown device');
  const token = await googleToken(env);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { token: device.fcm_token, data: { action: 'wake', deviceId } } })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

const tools = [
  { name: 'couchcode_create_pairing_code', description: 'Create a one-time code for pairing an Android CouchCode device', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' } }, required: ['deviceId'] } },
  { name: 'couchcode_device_status', description: 'Get a paired Android bridge device status', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' } }, required: ['deviceId'] } },
  { name: 'couchcode_start_agent', description: 'Wake the Android bridge and start its Termux agent', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' } }, required: ['deviceId'] } },
  { name: 'couchcode_submit_command', description: 'Queue a scoped command for a paired CouchCode device', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' }, command: { type: 'object' } }, required: ['deviceId', 'command'] } },
  { name: 'couchcode_command_status', description: 'Read command status and output', inputSchema: { type: 'object', properties: { commandId: { type: 'string' } }, required: ['commandId'] } }
];

async function callTool(env, name, args) {
  if (name === 'couchcode_create_pairing_code') {
    const code = randomToken(9).toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO pairing_codes (code_hash,device_id,expires_at) VALUES (?,?,?)').bind(await sha256(code), args.deviceId, expiresAt).run();
    return { code, deviceId: args.deviceId, expiresAt };
  }
  if (name === 'couchcode_device_status') {
    return env.DB.prepare('SELECT id,name,created_at,last_seen_at FROM devices WHERE id = ?').bind(args.deviceId).first();
  }
  if (name === 'couchcode_start_agent') return wakeDevice(env, args.deviceId);
  if (name === 'couchcode_submit_command') {
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO commands (id,device_id,payload,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(id, args.deviceId, JSON.stringify(args.command), 'queued', now, now).run();
    await wakeDevice(env, args.deviceId);
    return { id, status: 'queued' };
  }
  if (name === 'couchcode_command_status') return env.DB.prepare('SELECT * FROM commands WHERE id = ?').bind(args.commandId).first();
  throw new Error('Unknown tool');
}

async function mcp(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const rpc = await request.json();
  if (rpc.method === 'initialize') return json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'couchcode', version: '0.1.0' } } });
  if (rpc.method === 'tools/list') return json({ jsonrpc: '2.0', id: rpc.id, result: { tools } });
  if (rpc.method === 'tools/call') {
    try {
      const value = await callTool(env, rpc.params.name, rpc.params.arguments || {});
      return json({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
    } catch (error) {
      return json({ jsonrpc: '2.0', id: rpc.id, result: { isError: true, content: [{ type: 'text', text: error.message }] } });
    }
  }
  return json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname === '/mcp' && request.method === 'POST') return mcp(request, env);
    if (url.pathname === '/v1/pair/exchange' && request.method === 'POST') {
      const body = await request.json();
      const hash = await sha256(String(body.code || '').toUpperCase());
      const pair = await env.DB.prepare('SELECT * FROM pairing_codes WHERE code_hash = ?').bind(hash).first();
      if (!pair || pair.consumed_at || Date.parse(pair.expires_at) < Date.now() || pair.device_id !== body.deviceId) return json({ error: 'invalid pairing code' }, 401);
      const secret = randomToken(32); const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare('INSERT OR REPLACE INTO devices (id,name,fcm_token,secret_hash,created_at,last_seen_at) VALUES (?,?,?,?,?,?)').bind(body.deviceId, body.name || body.deviceId, body.fcmToken, await sha256(secret), now, now),
        env.DB.prepare('UPDATE pairing_codes SET consumed_at = ? WHERE code_hash = ?').bind(now, hash)
      ]);
      return json({ paired: true, deviceId: body.deviceId, deviceSecret: secret });
    }
    if (url.pathname === '/v1/device/token' && request.method === 'POST') {
      const body = await request.json();
      const device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(body.deviceId).first();
      const storedHash = device?.secret_hash;
      if (!storedHash || storedHash !== await sha256(bearer(request) || '')) return json({ error: 'unauthorized' }, 401);
      await env.DB.prepare('UPDATE devices SET fcm_token = ?, last_seen_at = ? WHERE id = ?').bind(body.fcmToken, new Date().toISOString(), body.deviceId).run();
      return json({ updated: true });
    }
    if (url.pathname === '/v1/device/commands' && request.method === 'GET') {
      const deviceId = url.searchParams.get('deviceId');
      const device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(deviceId).first();
      if (!device?.secret_hash || device.secret_hash !== await sha256(bearer(request) || '')) return json({ error: 'unauthorized' }, 401);
      const rows = await env.DB.prepare("SELECT id,payload,created_at FROM commands WHERE device_id = ? AND status = 'queued' ORDER BY created_at LIMIT 20").bind(deviceId).all();
      const now = new Date().toISOString();
      await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now, deviceId).run();
      return json({ commands: rows.results.map((row) => ({ id: row.id, command: JSON.parse(row.payload), createdAt: row.created_at })) });
    }
    if (url.pathname === '/v1/device/results' && request.method === 'POST') {
      const body = await request.json();
      const device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(body.deviceId).first();
      if (!device?.secret_hash || device.secret_hash !== await sha256(bearer(request) || '')) return json({ error: 'unauthorized' }, 401);
      const status = body.status === 'completed' ? 'completed' : 'failed';
      await env.DB.prepare('UPDATE commands SET status = ?, result = ?, updated_at = ? WHERE id = ? AND device_id = ?').bind(status, JSON.stringify(body), new Date().toISOString(), body.commandId, body.deviceId).run();
      return json({ received: true });
    }
    if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
    if (url.pathname === '/v1/devices/pair' && request.method === 'POST') {
      const body = await request.json(); const now = new Date().toISOString();
      await env.DB.prepare('INSERT OR REPLACE INTO devices (id,name,fcm_token,created_at,last_seen_at) VALUES (?,?,?,?,?)').bind(body.deviceId, body.name || body.deviceId, body.fcmToken, now, now).run();
      return json({ paired: true, deviceId: body.deviceId });
    }
    return json({ error: 'not found' }, 404);
  }
};
