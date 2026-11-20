// The map's local server: it serves a built map's folder on this machine, and nothing else. It listens on
// 127.0.0.1 under its own names only, serves files from the map folder and never outside it, and adds nothing
// to the page — the map is the same self-contained file, with no runtime server of its own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REPO, shopApp, scanAndBuild, cleanup } from './helpers.mjs';

const SERVE = path.join(REPO, 'skills', 'floorplan', 'assets', 'serve.mjs');
let root, server, base;
before(async () => {
  root = shopApp();
  scanAndBuild(root);
  const port = 20000 + Math.floor(Math.random() * 20000);
  server = spawn(process.execPath, [SERVE, path.join(root, 'floorplan'), '--port', String(port), '--no-open'], {
    cwd: root, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server didn't start: ${out}`)), 20000);
    server.stdout.on('data', (d) => { out += d; const m = /Floorplan: (http:\/\/\S+)/.exec(out); if (m) { clearTimeout(timer); resolve(m[1]); } });
    server.on('exit', (code) => reject(new Error(`server exited (${code}): ${out}`)));
  });
});
after(async () => {
  // wait for the server to exit first: on Windows its working folder can't be removed while it runs
  if (server && server.exitCode === null) await new Promise((resolve) => { server.once('exit', resolve); server.kill(); });
  cleanup(root);
});

test('it listens on 127.0.0.1 only', () => {
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('the page it serves is the map file itself, unchanged, with nothing injected', async () => {
  const served = await (await fetch(base + '/')).text();
  assert.equal(served, fs.readFileSync(path.join(root, 'floorplan', 'index.html'), 'utf8'));
  assert.ok(!served.includes('FLOORPLAN_SERVER'), 'the page carries no server settings or token');
});

test("the map folder's other files are served too, with their types", async () => {
  const r = await fetch(base + '/graph.json');
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.ok((await r.text()).length > 0);
});

/** A request to the server under another host name, as a site that rebinds its domain to 127.0.0.1 would send. */
const asHost = (host, p) => new Promise((resolve, reject) => {
  const u = new URL(base + p);
  http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { host } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject);
});

test('requests under any other host name are refused, page included (DNS rebinding)', async () => {
  const port = new URL(base).port;
  assert.equal(await asHost(`evil.example:${port}`, '/'), 403);
  assert.equal(await asHost('127.0.0.1:1', '/'), 403);
  assert.equal(await asHost(`localhost:${port}`, '/'), 200);
  assert.equal(await asHost(`127.0.0.1:${port}`, '/'), 200);
});

test('files outside the map folder are never served', async () => {
  // including a neighbouring folder whose name starts with "floorplan"
  fs.mkdirSync(path.join(root, 'floorplan-old'));
  fs.writeFileSync(path.join(root, 'floorplan-old', 'notes.txt'), 'private notes');
  for (const p of ['/../shop-api/config.js', '/%2e%2e/shop-api/config.js', '/..%2fshop-api%2fconfig.js', '/..%2ffloorplan-old%2fnotes.txt']) {
    const r = await fetch(base + p);
    const body = await r.text();
    assert.ok(!body.includes('DB_PASSWORD') && !body.includes('private notes'), `${p} -> ${r.status}`);
  }
});

test('a malformed address gets an error, and the server keeps running', async () => {
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
  assert.equal((await fetch(base + '/')).status, 200);
});

test('the map itself needs no server: the page makes no requests of any kind', async () => {
  const html = fs.readFileSync(path.join(root, 'floorplan', 'index.html'), 'utf8');
  for (const piece of ['fetch(', 'EventSource', 'XMLHttpRequest', 'sendBeacon', 'WebSocket']) assert.ok(!html.includes(piece), `the page never uses ${piece}`);
});
