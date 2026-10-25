import fs from 'node:fs';
import path from 'node:path';
import { Store } from './store.mjs';
import { Runner } from './runner.mjs';
import { createServer } from './server.mjs';

const configPath = path.resolve(process.env.POCKET_CONFIG || 'config.local.json');
if (!fs.existsSync(configPath)) { console.error('Сначала выполните npm run setup'); process.exit(1); }
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
for (const key of ['panelToken', 'actionsToken']) if (typeof config[key] !== 'string' || config[key].length < 40) throw new Error(`Invalid ${key}`);
if (config.panelToken === config.actionsToken) throw new Error('Use separate owner and Actions tokens');
if (!path.isAbsolute(config.workspace) || !fs.statSync(config.workspace).isDirectory()) throw new Error('Workspace must be an existing absolute directory');
if (config.publicUrl && (!config.publicUrl.startsWith('https://') || new URL(config.publicUrl).origin !== config.publicUrl)) throw new Error('publicUrl must be an HTTPS origin without a trailing slash');
const store = new Store(path.resolve(path.dirname(configPath), '.local'));
const runner = new Runner(config, store);
const server = createServer(config, store, runner);
server.listen(config.port, '127.0.0.1', () => console.log(`Pocket Codex: http://127.0.0.1:${config.port} — desktop ${config.desktop ? 'enabled' : 'disabled'}`));
server.on('error', e => { console.error(e.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await runner.close(); server.close(); server.closeAllConnections(); });
