import http from 'node:http';
import fs from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openapi } from './openapi.mjs';
import { terminal } from './store.mjs';

function equal(a, b) { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); }
function error(message, status = 400) { return Object.assign(new Error(message), { status }); }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw error('Ожидается application/json', 415);
  let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 65536) throw error('Запрос слишком большой', 413); }
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { throw error('Некорректный JSON'); }
}
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']], ['/icon.svg', ['icon.svg', 'image/svg+xml']], ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']]
]);
export function createServer(config, store, runner) {
  const failures = new Map();
  const server = http.createServer(async (req, res) => {
    const send = (code, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const localHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
      if (config.publicUrl) localHosts.add(new URL(config.publicUrl).host);
      if (!localHosts.has(req.headers.host)) throw error('Host не разрешён', 403);
      if (req.headers.origin) {
        const origins = new Set([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, config.publicUrl]);
        if (!origins.has(req.headers.origin)) throw error('Origin не разрешён', 403);
      }
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [name, type] = assets.get(url.pathname);
        return send(200, fs.readFileSync(fileURLToPath(new URL('../public/' + name, import.meta.url))), type);
      }
      if (req.method === 'GET' && url.pathname === '/openapi.json') return send(200, openapi(config.publicUrl));
      if (req.method === 'GET' && url.pathname === '/healthz') return send(200, { ok: true });
      const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const role = equal(token, config.panelToken) ? 'owner' : equal(token, config.actionsToken) ? 'actions' : null;
      const ip = req.socket.remoteAddress; const now = Date.now();
      const attempts = failures.get(ip);
      if (attempts && attempts.until < now) failures.delete(ip);
      if (!role) {
        const f = failures.get(ip) || { count: 0, until: now + 60000 }; f.count++; failures.set(ip, f);
        throw error(f.count > 30 ? 'Слишком много попыток' : 'Неверный ключ доступа', f.count > 30 ? 429 : 401);
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return send(200, { online: true, role, desktop: !!config.desktop, workspace: config.workspace, activeTaskId: runner.active?.task.id || null, publicUrl: config.publicUrl || null });
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        if (role !== 'owner') throw error('Доступно только владельцу', 403);
        await runner.close(); send(200, { stopped: true });
        server.close(); server.closeIdleConnections(); return;
      }
      if (url.pathname === '/api/tasks' && req.method === 'GET') return send(200, { tasks: store.tasks.slice(-30).reverse().map(t => ({ id: t.id, prompt: t.prompt, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt })) });
      if (url.pathname === '/api/tasks' && req.method === 'POST') {
        const data = await body(req);
        if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 16000) throw error('Задача должна содержать 1–16000 символов');
        if (typeof data.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.requestId)) throw error('Нужен уникальный requestId (8–100 символов)');
        if (data.parentId) {
          const parent = store.get(data.parentId);
          if (!parent?.threadId || !terminal(parent.status)) throw error('Продолжить можно завершённую задачу с сохранённым чатом', 409);
        }
        const t = store.add(data.prompt.trim(), data.requestId, data.parentId); runner.pump();
        return send(202, store.view(t, config.publicUrl));
      }
      const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]{36})(?:\/(cancel|approvals)(?:\/([^/]+))?)?$/);
      if (match) {
        const [, id, action, approvalId] = match, t = store.get(id);
        if (!t) throw error('Задача не найдена', 404);
        if (!action && req.method === 'GET') return send(200, store.view(t, config.publicUrl));
        if (action === 'cancel' && req.method === 'POST') { await runner.cancel(id); return send(200, store.view(t, config.publicUrl)); }
        if (action === 'approvals' && approvalId && req.method === 'POST') {
          if (role !== 'owner') throw error('Подтверждение доступно только владельцу в панели', 403);
          runner.respond(id, decodeURIComponent(approvalId), await body(req)); return send(200, store.view(t, config.publicUrl));
        }
      }
      throw error('Не найдено', 404);
    } catch (e) { if (!res.headersSent) send(e.status || 500, { error: e.status ? e.message : 'Внутренняя ошибка сервиса' }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
