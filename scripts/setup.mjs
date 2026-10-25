import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'config.local.json');
if (fs.existsSync(file)) { console.log('config.local.json уже существует; настройки сохранены.'); process.exit(0); }
const workspace = path.resolve(process.env.POCKET_WORKSPACE || path.join(root, '.local', 'workspace'));
fs.mkdirSync(workspace, { recursive: true });
const config = { port: 4317, codex: process.env.CODEX_BIN || 'codex', workspace, publicUrl: '', desktop: process.argv.includes('--desktop'), panelToken: randomBytes(32).toString('hex'), actionsToken: randomBytes(32).toString('hex'), taskTimeoutMs: 1800000 };
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log('Создан config.local.json. Секреты находятся только в этом файле.\nДля панели используйте panelToken, для GPT Actions — actionsToken.\nЗапуск: npm start. Диагностика: npm run doctor.');
