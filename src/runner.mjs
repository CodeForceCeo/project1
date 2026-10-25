import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rpc } from './rpc.mjs';
import { terminal } from './store.mjs';

const desktopServer = fileURLToPath(new URL('./desktop-mcp.mjs', import.meta.url));
export class Runner {
  constructor(config, store, RpcClass = Rpc) { this.config = config; this.store = store; this.RpcClass = RpcClass; this.active = null; this.stopping = false; }
  pump() {
    if (this.active || this.stopping) return;
    const task = this.store.tasks.find(t => t.status === 'queued');
    if (task) this.run(task).catch(e => { this.store.update(task, { status: 'failed', error: e.message }); });
  }
  async run(t) {
    const c = this.config;
    const args = ['app-server', '--listen', 'stdio://'];
    if (c.desktop) args.push('-c', 'mcp_servers.pocket_desktop.command=' + JSON.stringify(process.execPath), '-c', 'mcp_servers.pocket_desktop.args=' + JSON.stringify([desktopServer]));
    const rpc = new this.RpcClass(c.codex, args, c.workspace);
    const active = { task: t, rpc, done: null }; this.active = active;
    let finish;
    const ended = new Promise(resolve => { finish = resolve; }); active.done = finish;
    const fail = e => { if (!terminal(t.status)) this.store.update(t, { status: 'failed', error: e.message }); finish(); };
    rpc.on('closed', fail);
    rpc.on('diagnostic', text => { active.lastDiagnostic = text; });
    rpc.on('request', m => {
      const supported = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput', 'item/permissions/requestApproval'];
      if (!supported.includes(m.method)) {
        rpc.send({ id: m.id, error: { code: -32601, message: 'This request requires a supported local Codex client' } });
        this.store.event(t, 'warning', `Неподдерживаемый запрос: ${m.method}`); return;
      }
      t.approvals.push({ id: String(m.id), rpcId: m.id, method: m.method, params: m.params });
      this.store.update(t, { status: 'waiting_approval' });
    });
    rpc.on('notification', m => {
      const p = m.params || {};
      if (terminal(t.status)) return;
      if (m.method === 'turn/started') this.store.update(t, { turnId: p.turn.id });
      if (m.method === 'item/agentMessage/delta') {
        // Deltas are batched in memory; the polling client sees them immediately.
        t.liveText = (t.liveText || '') + p.delta; t.liveText = t.liveText.slice(-60000);
      }
      if (m.method === 'item/started') this.store.event(t, p.item.type, p.item.command || p.item.tool || p.item.type);
      if (m.method === 'item/completed') {
        const item = p.item;
        if (item.type === 'agentMessage') { t.result = (t.result + '\n\n' + item.text).trim().slice(-100000); t.liveText = ''; }
        this.store.event(t, item.type, item.text || item.aggregatedOutput || JSON.stringify(item));
      }
      if (m.method === 'error') this.store.event(t, 'error', p.error?.message || JSON.stringify(p));
      if (m.method === 'turn/completed') {
        const status = p.turn.status;
        this.store.update(t, { status: ['completed', 'interrupted', 'failed'].includes(status) ? status : 'failed', error: p.turn.error?.message, approvals: [] }); finish();
      }
    });
    this.store.update(t, { status: 'running', startedAt: new Date().toISOString() });
    const timeout = setTimeout(() => { this.cancel(t.id).catch(fail); }, c.taskTimeoutMs || 1800000);
    try {
      await rpc.initialize();
      if (terminal(t.status)) return;
      const parent = t.parentId && this.store.get(t.parentId);
      const params = { cwd: c.workspace, approvalPolicy: 'untrusted', sandbox: 'workspace-write', ...(c.model ? { model: c.model } : {}) };
      const response = parent?.threadId
        ? await rpc.call('thread/resume', { ...params, threadId: parent.threadId })
        : await rpc.call('thread/start', params);
      this.store.update(t, { threadId: response.thread.id });
      if (terminal(t.status)) return;
      const started = await rpc.call('turn/start', { threadId: t.threadId, input: [{ type: 'text', text: t.prompt }] });
      if (!terminal(t.status)) this.store.update(t, { turnId: started.turn.id });
      await ended;
    } catch (e) { fail(e); }
    finally {
      clearTimeout(timeout); rpc.close(); t.approvals = []; this.store.save();
      if (this.active === active) this.active = null;
      queueMicrotask(() => this.pump());
    }
  }
  async cancel(id) {
    const t = this.store.get(id); if (!t || terminal(t.status)) return;
    if (this.active?.task.id === id) {
      const a = this.active;
      if (t.threadId && t.turnId) {
        try { await a.rpc.call('turn/interrupt', { threadId: t.threadId, turnId: t.turnId }, 5000); } catch {}
      }
      this.store.update(t, { status: 'interrupted', approvals: [] }); a.done(); a.rpc.close();
    } else this.store.update(t, { status: 'interrupted', approvals: [] });
  }
  respond(id, approvalId, body) {
    const t = this.store.get(id), a = this.active;
    const p = t?.approvals.find(p => p.id === approvalId);
    if (!a || a.task.id !== id || !p) throw Object.assign(new Error('Запрос уже закрыт'), { status: 409 });
    let result;
    if (p.method === 'item/tool/requestUserInput') {
      const answers = {};
      for (const q of p.params.questions) {
        const answer = body.answers?.[q.id];
        if (typeof answer !== 'string' || !answer.trim() || answer.length > 4000) throw Object.assign(new Error('Ответьте на каждый вопрос'), { status: 400 });
        answers[q.id] = { answers: [answer] };
      }
      result = { answers };
    } else {
      if (!['accept', 'decline'].includes(body.decision)) throw Object.assign(new Error('Неверное решение'), { status: 400 });
      result = p.method === 'item/permissions/requestApproval'
        ? { permissions: body.decision === 'accept' ? p.params.permissions : {}, scope: 'turn' }
        : { decision: body.decision };
    }
    a.rpc.send({ id: p.rpcId, result });
    t.approvals = t.approvals.filter(x => x !== p);
    this.store.event(t, 'approval', body.decision || 'Ответ пользователя');
    this.store.update(t, { status: t.approvals.length ? 'waiting_approval' : 'running' });
  }
  async close() { this.stopping = true; if (this.active) await this.cancel(this.active.task.id); }
}
