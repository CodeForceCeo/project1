import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

// A single private stdio connection. No app-server socket is exposed to the network.
export class Rpc extends EventEmitter {
  constructor(command, args, cwd) {
    super();
    this.pending = new Map(); this.seq = 0; this.closed = false;
    this.child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => {});
    createInterface({ input: this.child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.method) this.emit(m.id === undefined ? 'notification' : 'request', m);
      else if (this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
    this.child.stderr.on('data', chunk => this.emit('diagnostic', chunk.toString().slice(0, 3000)));
    this.child.on('error', e => this.end(e));
    this.child.on('exit', (code, signal) => this.end(new Error(`Codex exited (${code ?? signal})`)));
  }
  end(error) {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
  send(value) {
    if (this.closed) throw new Error('Codex connection closed');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  call(method, params = {}, timeout = 60000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  async initialize() {
    const result = await this.call('initialize', { clientInfo: { name: 'pocket_codex', title: 'Pocket Codex', version: '1.0.0' } });
    this.send({ method: 'initialized', params: {} }); return result;
  }
  close() {
    this.child.stdin.end();
    if (this.child.exitCode !== null || !this.child.pid) return;
    if (process.platform === 'win32') {
      // Terminate this owned process tree, including its shell and MCP children.
      const killer = spawn('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => this.child.kill());
    } else this.child.kill();
  }
}
