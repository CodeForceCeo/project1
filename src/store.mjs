import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const terminal = status => ['completed', 'failed', 'interrupted'].includes(status);
export class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true }); this.file = path.join(directory, 'tasks.json');
    this.tasks = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    for (const t of this.tasks) if (!terminal(t.status)) {
      t.status = 'interrupted'; t.error = 'Сервис был перезапущен. Задача не повторена автоматически.'; t.approvals = [];
    }
    this.save();
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.tasks), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  add(prompt, key, parentId) {
    const existing = this.tasks.find(t => t.key === key);
    if (existing) {
      if (existing.prompt !== prompt || existing.parentId !== parentId) throw Object.assign(new Error('Ключ запроса уже использован для другой задачи'), { status: 409 });
      return existing;
    }
    if (this.tasks.filter(t => !terminal(t.status)).length >= 10) throw Object.assign(new Error('Очередь заполнена'), { status: 429 });
    if (this.tasks.length >= 100) {
      const index = this.tasks.findIndex(t => terminal(t.status));
      if (index >= 0) this.tasks.splice(index, 1);
    }
    const task = { id: randomUUID(), key, parentId, prompt, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: '', events: [], approvals: [] };
    this.tasks.push(task); this.save(); return task;
  }
  get(id) { return this.tasks.find(t => t.id === id); }
  update(t, patch) { Object.assign(t, patch, { updatedAt: new Date().toISOString() }); this.save(); }
  event(t, kind, text) {
    t.events.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 12000) });
    if (t.events.length > 300) t.events.shift(); this.update(t, {});
  }
  view(t, base = '') {
    const { key, ...safe } = t;
    return { ...safe, dashboardUrl: `${base}/#task=${t.id}` };
  }
}
