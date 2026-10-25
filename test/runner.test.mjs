import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Runner } from '../src/runner.mjs';
const pause = () => new Promise(r => setImmediate(r));
class FakeRpc extends EventEmitter {
  static instance;
  constructor() { super(); FakeRpc.instance = this; this.sent = []; this.calls = []; }
  async initialize() {}
  async call(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') return { turn: { id: 'turn-1' } };
    return {};
  }
  send(value) { this.sent.push(value); }
  close() { this.emit('closed', new Error('closed')); }
}
function setup() {
  const task = { id: 'one', prompt: 'Test', status: 'queued', result: '', events: [], approvals: [] };
  const store = { tasks: [task], get: id => store.tasks.find(t => t.id === id), save() {}, update(t, p) { Object.assign(t, p); }, event(t, kind, text) { t.events.push({ kind, text }); } };
  return { task, store, runner: new Runner({ codex: 'codex', workspace: process.cwd() }, store, FakeRpc) };
}
test('runner consumes events and distinguishes successful completion', async () => {
  const { task, runner } = setup(); const work = runner.run(task); await pause();
  const rpc = FakeRpc.instance;
  assert.equal(rpc.calls[0].params.approvalPolicy, 'untrusted');
  rpc.emit('notification', { method: 'item/agentMessage/delta', params: { delta: 'Hello' } }); assert.equal(task.liveText, 'Hello');
  rpc.emit('notification', { method: 'item/completed', params: { item: { type: 'agentMessage', text: 'Hello world' } } });
  rpc.emit('notification', { method: 'turn/completed', params: { turn: { status: 'completed' } } }); await work;
  assert.equal(task.status, 'completed'); assert.equal(task.result, 'Hello world'); assert.equal(runner.active, null);
});
test('approval and user input use typed RPC replies; stale approvals fail', async () => {
  const { task, runner } = setup(); const work = runner.run(task); await pause(); const rpc = FakeRpc.instance;
  rpc.emit('request', { id: 7, method: 'item/commandExecution/requestApproval', params: { command: 'test' } });
  assert.equal(task.status, 'waiting_approval'); runner.respond(task.id, '7', { decision: 'decline' });
  assert.deepEqual(rpc.sent.at(-1), { id: 7, result: { decision: 'decline' } });
  assert.throws(() => runner.respond(task.id, '7', { decision: 'accept' }));
  rpc.emit('request', { id: 'ask', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q', question: 'Which?' }] } });
  assert.throws(() => runner.respond(task.id, 'ask', { answers: {} }));
  runner.respond(task.id, 'ask', { answers: { q: 'first' } });
  assert.deepEqual(rpc.sent.at(-1).result, { answers: { q: { answers: ['first'] } } });
  await runner.cancel(task.id); await work; assert.equal(task.status, 'interrupted');
});
test('Codex process failure does not look like completion', async () => {
  const { task, runner } = setup(); const work = runner.run(task); await pause();
  FakeRpc.instance.emit('closed', new Error('process crashed')); await work;
  assert.equal(task.status, 'failed'); assert.equal(task.error, 'process crashed');
});
test('queued cancellation never starts the cancelled job', async () => {
  const { task, runner } = setup(); await runner.cancel(task.id); runner.pump();
  assert.equal(task.status, 'interrupted'); assert.equal(runner.active, null);
});
