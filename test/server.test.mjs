import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Store } from '../src/store.mjs';
import { createServer } from '../src/server.mjs';
const cleanups = [];
afterEach(async () => { for (const f of cleanups.splice(0)) await f(); });
async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-test-'));
  const store = new Store(dir);
  const runner = { pump() {}, respond() {}, async cancel(id) { store.update(store.get(id), { status: 'interrupted' }); } };
  const config = { port: 0, panelToken: 'owner'.repeat(16), actionsToken: 'actions'.repeat(16), publicUrl: 'https://pocket.example.com', workspace: dir };
  const server = createServer(config, store, runner);
  await new Promise(r => server.listen(0, '127.0.0.1', r)); config.port = server.address().port;
  cleanups.push(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const request = async (route, { token = config.panelToken, data, method = data ? 'POST' : 'GET', headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${config.port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: data ? JSON.stringify(data) : undefined });
    return { code: response.status, data: await response.json() };
  };
  return { request, store, config, dir };
}
test('authentication, CSRF origin and host protections', async () => {
  const { request, config } = await setup();
  assert.equal((await request('/api/tasks', { token: 'bad' })).code, 401);
  assert.equal((await request('/api/tasks', { headers: { Origin: 'https://evil.example' } })).code, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: config.port, path: '/api/tasks', headers: { Host: 'evil.example', Authorization: `Bearer ${config.panelToken}` } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await request('/api/tasks')).code, 200);
});
test('idempotent tasks, validation, cancellation and owner-only approvals', async () => {
  const { request, config } = await setup();
  const data = { prompt: 'Create plan.md', requestId: 'request_123' };
  const a = await request('/api/tasks', { data }); assert.equal(a.code, 202);
  const b = await request('/api/tasks', { data }); assert.equal(a.data.id, b.data.id);
  assert.equal((await request('/api/tasks', { data: { ...data, prompt: 'Other' } })).code, 409);
  assert.equal((await request('/api/tasks', { data: { prompt: ' ', requestId: 'request_456' } })).code, 400);
  assert.equal((await request(`/api/tasks/${a.data.id}/approvals/1`, { token: config.actionsToken, data: { decision: 'accept' } })).code, 403);
  assert.equal((await request('/api/shutdown', { token: config.actionsToken, method: 'POST' })).code, 403);
  assert.equal((await request(`/api/tasks/${a.data.id}/cancel`, { method: 'POST' })).data.status, 'interrupted');
  assert.equal((await request(`/api/tasks/${a.data.id}`)).data.key, undefined);
});
test('restart interrupts pending jobs and preserves completed results', async () => {
  const { store, dir } = await setup();
  const t = store.add('hello', 'persist_1'); const complete = store.add('done', 'persist_2');
  store.update(complete, { status: 'completed', result: 'result' });
  const restored = new Store(dir);
  assert.equal(restored.get(t.id).status, 'interrupted'); assert.equal(restored.get(complete.id).result, 'result');
});
test('queue capacity is bounded and Actions schema excludes approval endpoints', async () => {
  const { request, store } = await setup();
  for (let i = 0; i < 10; i++) store.add('job', 'capacity_' + i);
  assert.equal((await request('/api/tasks', { data: { prompt: 'eleventh', requestId: 'capacity_11' } })).code, 429);
  const schema = (await request('/openapi.json', { token: '' })).data;
  assert.ok(!JSON.stringify(schema).includes('/approvals'));
  assert.equal(schema.paths['/api/tasks'].post['x-openai-isConsequential'], true);
});
