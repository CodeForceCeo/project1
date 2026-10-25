// Optional local-only MCP adapter. Windows interactive desktop must be unlocked.
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/desktop.ps1', import.meta.url));
const tools = [
  { name: 'screenshot', description: 'Capture the primary Windows screen. Read the image before choosing click coordinates. Requires an unlocked interactive desktop.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'click', description: 'Click an observed primary-screen coordinate. Only act on the user-authorized task.', inputSchema: { type: 'object', properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, button: { type: 'string', enum: ['left', 'right'] } }, required: ['x', 'y'], additionalProperties: false } },
  { name: 'type_text', description: 'Type literal text into the focused control using Unicode keyboard events. Does not press Enter.', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 5000 } }, required: ['text'], additionalProperties: false } },
  { name: 'press_key', description: 'Press a named key combination in the focused window.', inputSchema: { type: 'object', properties: { key: { type: 'string', enum: ['ENTER', 'TAB', 'ESC', 'BACKSPACE', 'DELETE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'CTRL+A', 'CTRL+C', 'CTRL+V', 'CTRL+S', 'ALT+TAB', 'WIN'] } }, required: ['key'], additionalProperties: false } },
  { name: 'scroll', description: 'Scroll the active window vertically. Positive steps scroll up.', inputSchema: { type: 'object', properties: { steps: { type: 'integer', minimum: -10, maximum: 10 } }, required: ['steps'], additionalProperties: false } }
];
async function call(name, args = {}) {
  if (process.platform !== 'win32') throw new Error('Desktop tools require Windows');
  if (!tools.some(t => t.name === name)) throw new Error('Unknown tool');
  if (name === 'click' && (!Number.isInteger(args.x) || !Number.isInteger(args.y) || args.x < 0 || args.y < 0 || (args.button && !['left', 'right'].includes(args.button)))) throw new Error('Invalid coordinates');
  if (name === 'type_text' && (typeof args.text !== 'string' || args.text.length > 5000)) throw new Error('Invalid text');
  if (name === 'press_key' && !tools[3].inputSchema.properties.key.enum.includes(args.key)) throw new Error('Invalid key');
  if (name === 'scroll' && (!Number.isInteger(args.steps) || Math.abs(args.steps) > 10)) throw new Error('Invalid steps');
  const encoded = Buffer.from(JSON.stringify({ action: name, ...args }), 'utf8').toString('base64');
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Payload', encoded], { windowsHide: true, timeout: 20000, maxBuffer: 24 * 1024 * 1024 });
  const result = JSON.parse(stdout.trim());
  return name === 'screenshot' ? { content: [{ type: 'image', mimeType: 'image/png', data: result.image }, { type: 'text', text: `Primary screen ${result.width} x ${result.height}; coordinates refer to this image.` }] } : { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
// Serialize desktop actions: two calls cannot interleave input events.
let chain = Promise.resolve();
createInterface({ input: process.stdin }).on('line', line => {
  chain = chain.then(async () => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return;
    try {
      let result;
      if (m.method === 'initialize') result = { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'pocket-desktop', version: '1.0.0' } };
      else if (m.method === 'tools/list') result = { tools };
      else if (m.method === 'ping') result = {};
      else if (m.method === 'tools/call') result = await call(m.params.name, m.params.arguments);
      else return send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
      send({ id: m.id, result });
    } catch (e) { send({ id: m.id, result: { isError: true, content: [{ type: 'text', text: e.message }] } }); }
  });
});
