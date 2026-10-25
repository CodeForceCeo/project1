const $ = id => document.getElementById(id);
const labels = { queued: 'В очереди', running: 'Выполняется', waiting_approval: 'Нужен ваш ответ', completed: 'Готово', failed: 'Ошибка', interrupted: 'Остановлено' };
let token = sessionStorage.getItem('pocket-key') || '', selected = location.hash.startsWith('#task=') ? location.hash.slice(6) : null, parentId, timer, busy = false, lastApprovalSignature = '', requestId;
const done = t => ['completed', 'failed', 'interrupted'].includes(t.status);
function notice(text) { $('notice').textContent = text; $('notice').hidden = false; clearTimeout(timer); timer = setTimeout(() => $('notice').hidden = true, 7000); }
async function api(route, method = 'GET', data) {
  const r = await fetch(route, { method, headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(15000) });
  const result = await r.json(); if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`); return result;
}
function element(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function select(id) { selected = id; location.hash = 'task=' + id; lastApprovalSignature = ''; refresh().catch(e => notice(e.message)); }
function render(t) {
  $('detail').hidden = false; $('taskTitle').textContent = t.prompt; $('taskStatus').textContent = labels[t.status] || t.status;
  $('taskTime').textContent = new Date(t.createdAt).toLocaleString('ru-RU');
  $('cancel').hidden = done(t); $('continueTask').hidden = !done(t) || !t.threadId;
  $('result').textContent = [t.result, t.liveText].filter(Boolean).join('\n\n') || (t.status === 'waiting_approval' ? 'Codex ждёт вашего ответа ниже.' : 'Ожидаем ответ…');
  $('taskError').hidden = !t.error; $('taskError').textContent = t.error || '';
  $('eventCount').textContent = `(${t.events.length})`;
  $('events').replaceChildren(...t.events.slice(-80).map(event => {
    const d = element('div', undefined, 'event'); d.append(element('time', new Date(event.at).toLocaleTimeString('ru-RU')), element('b', event.kind), element('pre', event.text)); return d;
  }));
  const signature = JSON.stringify(t.approvals);
  if (signature !== lastApprovalSignature) {
    lastApprovalSignature = signature;
    $('approvals').replaceChildren(...t.approvals.map(a => {
      const d = element('div', undefined, 'approval'); d.append(element('h3', 'Codex запрашивает ваш ответ'));
      const inputs = {};
      if (a.method === 'item/tool/requestUserInput') {
        for (const q of a.params.questions) {
          const label = element('label', q.question); const input = element('input'); input.maxLength = 4000;
          input.placeholder = q.options?.map(o => o.label).join(' / ') || 'Ваш ответ'; label.append(input); d.append(label); inputs[q.id] = input;
        }
      } else d.append(element('pre', JSON.stringify(a.params, null, 2)));
      const respond = async decision => {
        try {
          const answers = Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, input.value]));
          await api(`/api/tasks/${t.id}/approvals/${encodeURIComponent(a.id)}`, 'POST', Object.keys(inputs).length ? { answers } : { decision }); await refresh();
        } catch (e) { notice(e.message); }
      };
      const accept = element('button', Object.keys(inputs).length ? 'Отправить ответ' : 'Разрешить один раз'); accept.onclick = () => respond('accept'); d.append(accept);
      if (!Object.keys(inputs).length) { const reject = element('button', 'Отклонить', 'danger'); reject.onclick = () => respond('decline'); d.append(reject); }
      return d;
    }));
  }
}
async function refresh() {
  if (!token || busy) return; busy = true;
  try {
    const status = await api('/api/status');
    if (status.role !== 'owner') throw new Error('Для панели нужен panelToken, а не actionsToken');
    $('connection').textContent = 'На связи'; $('indicator').classList.add('online');
    $('login').hidden = true; $('console').hidden = false; $('logout').hidden = false;
    $('mode').textContent = status.desktop ? 'Рабочий стол включён' : 'Рабочая папка';
    $('scope').textContent = status.desktop ? 'Codex может управлять рабочим столом' : 'Выполнение в рабочей папке';
    const { tasks } = await api('/api/tasks'); $('count').textContent = tasks.length;
    $('tasks').replaceChildren(...tasks.map(t => {
      const b = element('button', t.prompt.length > 45 ? t.prompt.slice(0, 45) + '…' : t.prompt, t.id === selected ? 'active' : '');
      b.append(element('small', labels[t.status] || t.status)); b.onclick = () => select(t.id); return b;
    }));
    if (selected) render(await api('/api/tasks/' + selected));
  } finally { busy = false; }
}
$('loginForm').onsubmit = async e => {
  e.preventDefault(); token = $('token').value.trim();
  try { await refresh(); sessionStorage.setItem('pocket-key', token); $('token').value = ''; } catch (e) { token = ''; notice(e.message); }
};
$('logout').onclick = () => { sessionStorage.removeItem('pocket-key'); location.reload(); };
$('newTask').onclick = () => { parentId = null; selected = null; history.replaceState(null, '', '/'); $('detail').hidden = true; $('heading').textContent = 'Что сделаем сегодня?'; $('subtitle').textContent = 'Ваш компьютер готов принять задачу.'; $('prompt').focus(); };
$('continueTask').onclick = () => { parentId = selected; $('heading').textContent = 'Продолжим работу'; $('subtitle').textContent = 'Codex учтёт предыдущие сообщения этого чата.'; $('prompt').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
$('taskForm').onsubmit = async e => {
  e.preventDefault(); $('submit').disabled = true;
  requestId ||= crypto.randomUUID();
  try {
    const t = await api('/api/tasks', 'POST', { prompt: $('prompt').value, requestId, ...(parentId ? { parentId } : {}) });
    requestId = null; $('prompt').value = ''; parentId = null; select(t.id);
  } catch (e) { notice(e.message); } finally { $('submit').disabled = false; }
};
$('prompt').addEventListener('input', () => { requestId = null; });
$('cancel').onclick = async () => { try { await api(`/api/tasks/${selected}/cancel`, 'POST'); await refresh(); } catch (e) { notice(e.message); } };
for (const button of document.querySelectorAll('[data-prompt]')) button.onclick = () => { $('prompt').value = button.dataset.prompt; requestId = null; $('prompt').focus(); };
async function poll() {
  try { if (!document.hidden) await refresh(); } catch (e) { $('connection').textContent = 'Нет связи · повторяем'; $('indicator').classList.remove('online'); }
  setTimeout(poll, 1800);
}
poll();
