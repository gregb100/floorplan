#!/usr/bin/env node
// floorplan/serve.mjs: serve a built map on this machine, and export a copy to share. Generated maps are
// self-contained HTML files that need no server; this one is a convenience for viewing a map at a tidy local
// address. The server listens on 127.0.0.1 only, serves files from the map folder, and runs nothing else.
//
// usage: node serve.mjs [mapdir] [--port 4378] [--no-open]
//        node serve.mjs [mapdir] --stop
//        node serve.mjs [mapdir] --export [<file>] [--include flows,notes,recent,health]   (a copy to share; default flows,notes)
//
// The map page makes no requests of any kind: it is the same file opened directly, with its own scripts
// allowed (by hash) and nothing else. The export is the same page, marked as exported, stripped of this
// machine's paths, and unable to contact anything at all.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// how data goes into the page, and the page's Content-Security-Policy (assets/page-safety.mjs)
import { scriptJson, withPolicy } from './page-safety.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
// the map folder: the first argument that isn't a flag (default: this file's own folder)
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const mapDir = path.resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--export' && argv[i - 1] !== '--include' && argv[i - 1] !== '--port' && argv[i - 1] !== '--idle-exit') || here);
// a JSON file in this folder; one a person or an agent saved with a byte order mark at the start (Windows PowerShell does) reads the same
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i < 0 ? dflt : argv[i + 1]; };
const has = (name) => flags.has('--' + name);
const stateFile = path.join(mapDir, '.cache', 'server.json');
const readState = () => { try { return readJson(stateFile); } catch { return null; } };
if (has('stop')) {
  const s = readState();
  let stopped = false;
  if (s?.pid) { try { process.kill(s.pid); stopped = true; } catch {} }
  try { fs.unlinkSync(stateFile); } catch {}
  console.log(stopped ? `Stopped the map server (${s.url}).` : 'The map server was not running.');
  process.exit(0);
}
if (!fs.existsSync(path.join(mapDir, 'index.html'))) { console.error(`✗ No map in ${mapDir}. Run build.mjs first.`); process.exit(1); }

// Health issues marked "not a problem" on the map; build.mjs folds them into graph.json
const dismissedFile = path.join(mapDir, 'health-dismissed.json');
const readDismissed = () => { try { const { dismissed } = readJson(dismissedFile); return Array.isArray(dismissed) ? dismissed : []; } catch { return []; } };

// ---------- export: a copy of the map to share ----------
// The same self-contained page, marked as exported: no links into this computer, and only the extras asked for.
const EXPORT_PARTS = ['flows', 'notes', 'recent', 'health'];
const EXPORT_DEFAULT = ['flows', 'notes'];
const DATA_START = '<script>window.FLOORPLAN = ';
function exportMap(include, extraFlows = []) {
  const html = fs.readFileSync(path.join(mapDir, 'index.html'), 'utf8');
  const a = html.indexOf(DATA_START), b = html.indexOf(';</script>', a);
  if (a < 0 || b < 0) throw Object.assign(new Error('This map is too old to export. Rebuild the floorplan first.'), { plain: true });
  const g = JSON.parse(html.slice(a + DATA_START.length, b));
  const on = EXPORT_PARTS.filter((p) => include.includes(p));
  const out = {
    ...g,
    // the folder path is this computer's
    meta: { ...g.meta, root: null, repos: (g.meta.repos || []).map(({ remote, ...r }) => r), exported: { at: new Date().toISOString(), include: on } },
    flows: on.includes('flows') ? [...g.flows, ...extraFlows.filter((f) => !g.flows.some((x) => x.id === f.id))] : [],
    tour: on.includes('flows') ? g.tour : [],
    files: on.includes('notes') ? g.files : g.files.map(({ note, ...f }) => f),
  };
  if (!on.includes('recent')) delete out.recent;
  if (!on.includes('health')) delete out.health;
  // dismissals made since the last build travel with the copy (the page applies them; no reasons, which are notes to self)
  else if (out.health) { const list = readDismissed().map(({ reason, ...d }) => d); if (list.length) out.health = { ...out.health, dismissed: list }; else delete out.health.dismissed; }
  const json = scriptJson(out);
  const slug = String(g.project?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'floorplan';
  // a copy to share talks to nothing: only its own scripts run (by hash), and it can't send anything anywhere
  return { html: withPolicy(html.slice(0, a + DATA_START.length) + json + html.slice(b), 'export'), name: `${slug}-map.html`, include: on, plan: !!g.meta?.blueprint };
}
/** Flows requested from the map since it was last built, as the page sends them: checked and trimmed. */
const cleanFlows = (list) => (Array.isArray(list) ? list : []).slice(0, 50)
  .filter((f) => f && typeof f.id === 'string' && Array.isArray(f.steps))
  .map((f) => ({
    id: f.id.slice(0, 100), title: String(f.title || 'Flow').slice(0, 200), description: String(f.description || '').slice(0, 1000), custom: true,
    steps: f.steps.slice(0, 60).filter((s) => s && typeof s.ref === 'string').map((s) => ({ ref: s.ref.slice(0, 300), note: String(s.note || '').slice(0, 2000) })),
  }))
  .filter((f) => f.steps.length >= 2);
if (has('export')) {
  const dest = opt('export');
  const include = String(opt('include', EXPORT_DEFAULT.join(','))).split(',').map((s) => s.trim().toLowerCase());
  try {
    const x = exportMap(include);
    const file = path.resolve(dest && !dest.startsWith('--') ? dest : path.join(mapDir, x.name));
    fs.writeFileSync(file, x.html);
    console.log(`Exported the map to ${file}`);
    const label = { flows: 'flows and the tour', notes: 'notes', recent: 'recent work', health: x.plan ? 'the design review' : 'the health check' };
    console.log(`Includes: the map${x.include.map((p) => ', ' + label[p]).join('')}. One file that opens in any browser.`);
    if (x.include.includes('health') && !x.plan) console.log('It includes the health check: which endpoints are open and where secrets sit in the code (never their values). Share it only with people you trust.');
    process.exit(0);
  } catch (e) { console.error(`✗ Couldn't export the map: ${e.message}`); process.exit(1); }
}

// ---------- serve the map folder on this machine ----------
const wantPort = Number(opt('port', 4378));
const selfHash = crypto.createHash('sha1').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12);
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  // only this machine's own names: a website that points its domain at 127.0.0.1 (DNS rebinding) would
  // otherwise count as the same origin as the map
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(String(req.headers.host || '').toLowerCase())) { res.writeHead(403); return res.end('unknown host'); }
  const url = new URL(req.url, 'http://127.0.0.1'); // a fixed local base: the host header was checked, and nothing here reaches it
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(mapDir, 'index.html')));
  }
  let file;
  try { file = path.join(mapDir, decodeURIComponent(url.pathname)); } catch { res.writeHead(400); return res.end('bad address'); }
  // inside this folder only: a neighbour like ../floorplan-old/ also starts with this folder's path
  if (!file.startsWith(mapDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
// another map (or anything else) on the port: take the next free one
let port = wantPort;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < wantPort + 20) { port++; server.listen(port, '127.0.0.1'); return; }
  console.error(`✗ Couldn't start the map server: ${e.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1');
server.on('listening', () => {
  const u = `http://127.0.0.1:${port}`;
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ pid: process.pid, port, url: u, hash: selfHash, startedAt: new Date().toISOString() }, null, 2));
  } catch {}
  const forget = () => { try { if (readState()?.pid === process.pid) fs.unlinkSync(stateFile); } catch {} };
  process.on('exit', forget);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
  console.log(`Floorplan: ${u}`);
  if (!has('no-open')) {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', u]] : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
    try { spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref(); } catch {}
  }
});
