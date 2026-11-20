// A skill installed read-only: some package managers, system-wide installs and locked-down machines install
// files nobody may write to. The build writes only its own files into the map folder — never the skill's —
// and it no longer places serve.mjs or page-safety.mjs next to the map, so nothing outside floorplan/ has to
// stay writable. A read-only install must keep building maps again and again, and the map folder must hold
// only what the build owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SKILL, makeProject, cleanup } from './helpers.mjs';

const filesIn = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath ?? e.path, e.name));
const canWrite = (file) => { try { fs.closeSync(fs.openSync(file, 'r+')); return true; } catch { return false; } };
const readOnly = (file) => fs.chmodSync(file, 0o444);
const writable = (file) => fs.chmodSync(file, 0o644);

/** Whether marking a file read-only stops this user writing to it (it doesn't for root, or on some file systems). */
function readOnlyMeansSomething() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'floorplan-readonly-'));
  const probe = path.join(dir, 'probe.txt');
  try {
    fs.writeFileSync(probe, 'x');
    readOnly(probe);
    return !canWrite(probe);
  } catch { return false; } finally {
    try { writable(probe); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a skill installed read-only builds again and again', (t) => {
  if (!readOnlyMeansSomething()) return t.skip('this user can write to read-only files here, so there is nothing to check');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'floorplan-readonly-'));
  const skill = path.join(tmp, 'skill');
  const root = makeProject({ 'api/server.js': 'export const port = 3000;\n', 'web/app.js': `import { port } from '../api/server.js';\nexport default port;\n` }, {
    arch: { project: { name: 'Shop', summary: 'A sample shop.' }, nodes: [
      { id: 'api', label: 'Server', kind: 'service', summary: 'The shop server.', paths: ['api/**'] },
      { id: 'web', label: 'Website', kind: 'ui', summary: 'The shop website.', paths: ['web/**'] },
    ] },
  });
  const script = (name, ...args) => execFileSync(process.execPath, [path.join(skill, 'scripts', name), root, ...args], { encoding: 'utf8', stdio: 'pipe' });
  const build = (when) => {
    let out;
    try { out = script('build.mjs', '--json'); } catch (e) { assert.fail(`${when} failed (exit ${e.status}):\n${e.stdout}\n${e.stderr}`); }
    assert.equal(JSON.parse(out).ok, true, when);
    return JSON.parse(out);
  };
  try {
    fs.cpSync(SKILL, skill, { recursive: true });
    filesIn(skill).forEach(readOnly);
    script('scan.mjs');
    build('the first build');
    build('the second build');
  } finally {
    // give write permission back, so the temp folders can be removed everywhere
    for (const file of [...(fs.existsSync(skill) ? filesIn(skill) : [])]) { try { writable(file); } catch {} }
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(root);
  }
});

test('the map folder holds only the files the build writes — a build drops nothing executable beside the map', () => {
  const root = makeProject({ 'api/server.js': 'export const port = 3000;\n' }, {
    arch: { project: { name: 'Shop', summary: 'A sample shop.' }, nodes: [{ id: 'api', label: 'Server', kind: 'service', summary: 'The shop server.', paths: ['api/**'] }] },
  });
  try {
    // a map made by an earlier version: dead copies beside the map, one of them read-only
    const old = path.join(root, 'floorplan', 'serve.mjs');
    fs.mkdirSync(path.join(root, 'floorplan'), { recursive: true });
    fs.writeFileSync(old, '// an old map\'s leftover\n');
    fs.writeFileSync(path.join(root, 'floorplan', 'page-safety.mjs'), '// an old map\'s leftover\n');
    readOnly(old);
    execFileSync(process.execPath, [path.join(SKILL, 'scripts', 'scan.mjs'), root], { encoding: 'utf8', stdio: 'pipe' });
    const result = JSON.parse(execFileSync(process.execPath, [path.join(SKILL, 'scripts', 'build.mjs'), root, '--json'], { encoding: 'utf8', stdio: 'pipe' }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.wrote, ['floorplan/.gitignore', 'floorplan/graph.json', 'floorplan/index.html', 'floorplan/query.mjs'], 'exactly what the build owns');
    assert.ok(!fs.existsSync(old), 'the leftover serve.mjs is removed');
    assert.ok(!fs.existsSync(path.join(root, 'floorplan', 'page-safety.mjs')), 'the leftover page-safety.mjs is removed');
    assert.ok(fs.existsSync(path.join(root, 'floorplan', 'index.html')), 'the map itself is there');
    assert.ok(fs.existsSync(path.join(root, 'floorplan', 'query.mjs')), 'and its lookup helper');
  } finally {
    for (const name of ['serve.mjs', 'page-safety.mjs']) { try { writable(path.join(root, 'floorplan', name)); } catch {} }
    cleanup(root);
  }
});
