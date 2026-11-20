// Exporting a copy of the map to share: serve.mjs --export writes the same self-contained page, marked as
// exported, without this computer's details, and with only the extras asked for. Health and recent work are
// left out unless asked for. The map's Export button is gone with the rest of its server-backed features; the
// export is a command, run against the map folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, shopApp, run, readJson, writeJson, cleanup, FAKE_PASSWORD } from './helpers.mjs';

const TOKEN_IN_REMOTE = 'ghp-not-a-real-token-1234';
const SERVE = path.join(REPO, 'skills', 'floorplan', 'assets', 'serve.mjs');
let root;
/** The graph inside an exported page. */
const dataOf = (html) => JSON.parse(/<script>window\.FLOORPLAN = (.*?);<\/script>/s.exec(html)[1]);
/** Runs serve.mjs --export with these arguments; returns the exported page and what it printed. */
function exportCli(...args) {
  const out = execFileSync(process.execPath, [SERVE, path.join(root, 'floorplan'), '--export', ...args], { cwd: root, encoding: 'utf8' });
  const file = /Exported the map to (.+)/.exec(out)[1].trim();
  return { out, html: fs.readFileSync(file, 'utf8'), file };
}

before(() => {
  root = shopApp();
  execFileSync('git', ['-C', path.join(root, 'shop-api'), 'remote', 'add', 'origin', `https://someone:***}@example.com/shop-api.git`]);
  const arch = readJson(path.join(root, 'floorplan', 'architecture.json'));
  writeJson(path.join(root, 'floorplan', 'architecture.json'), {
    ...arch,
    annotations: [{ path: 'shop-api/config.js', note: 'Moving to the secrets manager next sprint.' }],
    flows: [{ id: 'refund', title: 'Refund', description: 'A customer asks for a refund.', steps: [{ node: 'web', note: 'The website asks.' }, { node: 'api', note: 'The server refunds.' }] }],
  });
  writeJson(path.join(root, 'floorplan', 'recent-work.json'), { tasks: [{ title: 'Refunds', summary: 'Added refunds.', items: [{ ref: 'shop-api/routes/orders.js', change: 'changed', note: 'Refund endpoint.' }] }] });
  run('scan.mjs', root);
  run('build.mjs', root, '--no-claude-md');
});
after(() => cleanup(root));

test('the map has health, recent work, a note, a flow and a remote to leave out', () => {
  const g = dataOf(fs.readFileSync(path.join(root, 'floorplan', 'index.html'), 'utf8'));
  assert.ok(g.health.issues.length > 0);
  assert.equal(g.recent.items.length, 1);
  assert.ok(g.files.some((f) => f.note));
  assert.equal(g.flows.length, 1);
  assert.ok(g.meta.root);
});

test('by default the export keeps flows and notes, and leaves out health, recent work and this computer', () => {
  const { html, file, out } = exportCli();
  assert.equal(path.basename(file), 'shop-map.html');
  assert.equal(path.dirname(file), path.join(fs.realpathSync(root), 'floorplan'));
  const g = dataOf(html);
  assert.match(g.meta.exported.at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(g.meta.exported.include, ['flows', 'notes']);
  assert.equal(g.health, undefined);
  assert.equal(g.recent, undefined);
  assert.equal(g.flows.length, 1);
  assert.ok(g.files.some((f) => f.note));
  assert.equal(g.meta.root, null);
  assert.ok(g.meta.repos.every((r) => !('remote' in r)));
  assert.ok(!html.includes(TOKEN_IN_REMOTE), 'no sign-in token from a git remote');
  const here = readJson(path.join(root, 'floorplan', 'graph.json')).meta.root;
  assert.ok(here && !html.includes(here), 'no folder path from this computer');
  assert.ok(!html.includes('FLOORPLAN_SERVER='), 'no server details');
});

test('health and recent work go in only when asked for, with a warning about health', () => {
  const { html, out } = exportCli(path.join(root, 'all.html'), '--include', 'flows,notes,recent,health');
  const g = dataOf(html);
  assert.deepEqual(g.meta.exported.include, ['flows', 'notes', 'recent', 'health']);
  assert.ok(g.health.issues.length > 0);
  assert.equal(g.recent.items.length, 1);
  assert.match(out, /Share it only with people you trust/);
  // where a secret sits, never the secret itself
  assert.ok(!html.includes(FAKE_PASSWORD));
});

test('flows, the tour and notes can be left out too', () => {
  const { html } = exportCli(path.join(root, 'bare.html'), '--include', 'none');
  const g = dataOf(html);
  assert.deepEqual(g.meta.exported.include, []);
  assert.deepEqual(g.flows, []);
  assert.deepEqual(g.tour, []);
  assert.ok(g.files.every((f) => !('note' in f)));
});

test('the exported page is still the whole map, ready to open', () => {
  const { html } = exportCli(path.join(root, 'page.html'));
  const g = dataOf(html);
  const built = readJson(path.join(root, 'floorplan', 'graph.json'));
  assert.equal(g.files.length, built.files.length);
  assert.equal(g.routes.length, built.routes.length);
  assert.equal(g.links.length, built.links.length);
  assert.match(html, /^<!doctype html>/i);
});
