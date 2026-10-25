import fs from 'node:fs';
import { Rpc } from '../src/rpc.mjs';
const config = JSON.parse(fs.readFileSync(new URL('../config.local.json', import.meta.url), 'utf8'));
const rpc = new Rpc(config.codex, ['app-server', '--listen', 'stdio://'], config.workspace);
rpc.on('closed', () => {});
try {
  await rpc.initialize();
  const account = await rpc.call('account/read', {});
  console.log('App Server: OK');
  console.log('Авторизация:', account.account ? 'OK' : 'выполните codex login');
  const models = await rpc.call('model/list', {});
  console.log('Модели:', models.data?.map(m => m.id).join(', ') || 'см. настройки Codex');
  if (!account.account) process.exitCode = 1;
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { rpc.close(); }
