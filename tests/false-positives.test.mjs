// Two kinds of false alarm a user reported on the Health tab, and the way out for the rest. A password hash
// isn't the password, and an encrypted backup isn't an exposed one. Whatever the checks still get wrong can be
// marked "not a problem" on the map: saved next to it, set apart, out of the counts, back if the finding changes.
// Secret-looking values are assembled at runtime so none is ever committed to this repo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, lib, makeProject, shopApp, run, scanAndBuild, readGraph, cleanup, FAKE_PASSWORD } from './helpers.mjs';

const { findIssues, leakyPublicVar, protectedValue, dismissalFor, withDismissed } = await lib('health.mjs');
const secrets = (src, p = 'app/config.py', lang = 'python') => findIssues(src, { path: p, category: 'code', lang }).filter((x) => x.k === 'secret');
const BCRYPT = '$2b$12$' + 'aBcD1e2F3g4H5i6J7k8L9m'.repeat(2) + 'n0P3q4R5s6';
const ARGON = '$argon2id$v=19$m=65536,t=3,p=4$' + 'c2FsdHNhbHQ' + '$' + 'aGFzaGhhc2hoYXNo';
const ARCH = { project: { name: 'App', summary: 'A sample app.' }, nodes: [{ id: 'app', label: 'App', kind: 'ui', summary: 'The app.', paths: ['**'] }] };
const FAKE_GITHUB_TOKEN = 'ghp_' + 'aBcD' + '1e2F3g4H5i6J7k8L9m0N1o2P3q4R5s6T7u8V';
const BLOB = 'Zm9vYmFyYmF6cXV4'.repeat(4);
const ENCRYPTED = { dotenvx: 'encrypted:' + BLOB, sops: `ENC[AES256_GCM,data:${BLOB},iv:abc,tag:def,type:str]`, openssl: 'U2FsdGVkX1' + BLOB, fernet: 'gAAAAA' + BLOB, vault: 'vault:v1:' + BLOB };

// ---------- 1. a hash isn't the password ----------
test('a password hash is not flagged as a password', () => {
  assert.deepEqual(secrets(`DB_PASSWORD = "${BCRYPT}"\nADMIN_PASSWORD = "${ARGON}"\n`), []);
  assert.deepEqual(secrets(`ADMIN_PASSWORD_HASH = "${FAKE_PASSWORD}"\nhashed_password = "${FAKE_PASSWORD}"\n`), []);
  assert.deepEqual(secrets(`const adminPasswordHash = "${FAKE_PASSWORD}";`, 'app/config.ts', 'typescript'), []);
});

test('the same password under an ordinary name is still flagged', () => {
  assert.equal(secrets(`DB_PASSWORD = "${FAKE_PASSWORD}"`).length, 1);
});

test('a name only excuses a hash, not the secret that makes one, and never a real key format', () => {
  for (const name of ['HASH_SECRET', 'HASH_TOKEN', 'JWT_HASH_SECRET']) assert.equal(secrets(`${name} = "${FAKE_PASSWORD}"`).length, 1, name);
  assert.equal(secrets(`PASSWORD_HASH = "${FAKE_GITHUB_TOKEN}"`).length, 1);
});

test('a hash in a browser variable is not a leaked secret, and a password there still is', () => {
  assert.equal(leakyPublicVar('VITE_ADMIN_PASSWORD_HASH'), null);
  assert.notEqual(leakyPublicVar('VITE_ADMIN_PASSWORD'), null);
});

const browserVarIssues = (value) => {
  const root = makeProject({
    'app/.env.production': `VITE_ADMIN_PASSWORD=${value}\n`,
    'app/package.json': '{"name":"a","dependencies":{"vite":"5"}}',
    'app/src/main.js': `console.log(import.meta.env.VITE_ADMIN_PASSWORD);\n`,
  }, { repos: ['app'], arch: ARCH });
  try {
    scanAndBuild(root);
    return readGraph(root).health.issues.filter((i) => i.kind === 'public-env-secret');
  } finally { cleanup(root); }
};

test('a browser variable whose value is a hash raises nothing, and the same variable with a password does', () => {
  assert.deepEqual(browserVarIssues(BCRYPT), []);
  assert.equal(browserVarIssues(FAKE_PASSWORD).length, 1);
});

// ---------- 2. an encrypted backup isn't exposed ----------
test('encrypted values are recognised in every common format', () => {
  for (const [what, v] of Object.entries(ENCRYPTED)) assert.ok(protectedValue(v), what);
  assert.ok(!protectedValue(FAKE_PASSWORD));
  assert.ok(!protectedValue(BLOB), 'random-looking text is not proof of encryption');
});

const envIssues = (body, name = '.env.backup') => {
  const root = makeProject({ [`app/${name}`]: body, 'app/index.js': 'console.log(1);\n' }, { repos: ['app'], arch: ARCH });
  try {
    scanAndBuild(root);
    return readGraph(root).health.issues.filter((i) => i.kind === 'env-file');
  } finally { cleanup(root); }
};

test('an encrypted .env backup is not reported as an exposed settings file', () => {
  assert.deepEqual(envIssues(Object.entries(ENCRYPTED).map(([k, v]) => `${k.toUpperCase()}_PASSWORD=${v}`).join('\n') + '\n'), []);
});

test('a backup with one value left unencrypted is still reported, for that value only', () => {
  const [issue, ...rest] = envIssues(`A_PASSWORD=${ENCRYPTED.sops}\nB_PASSWORD=${FAKE_PASSWORD}\n`);
  assert.equal(rest.length, 0);
  assert.deepEqual(issue.locations.map((l) => l.line), [2]);
});

test('a passphrase-protected private key is left alone, and a plain one is not', () => {
  const body = 'MIIE' + 'abcd'.repeat(30);
  assert.deepEqual(secrets(`-----BEGIN ENCRYPTED PRIVATE KEY-----\n${body}\n-----END ENCRYPTED PRIVATE KEY-----\n`, 'certs/app.txt', 'text'), []);
  assert.deepEqual(secrets(`-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\n${body}\n-----END RSA PRIVATE KEY-----\n`, 'certs/app.txt', 'text'), []);
  assert.equal(secrets(`-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n`, 'certs/app.txt', 'text').length, 1);
});

// ---------- 3. marking the rest "not a problem" ----------
const issue = { id: 'secret:a.py', severity: 'high', locations: [{ file: 'a.py', line: 10 }, { file: 'b.py', line: 3 }] };
const mark = (over = {}) => [{ id: issue.id, severity: 'high', locations: ['a.py:10', 'b.py:3'], ...over }];

test('a dismissal covers the issue it was made for', () => {
  assert.ok(dismissalFor(issue, mark()));
  assert.equal(dismissalFor({ ...issue, id: 'secret:other.py' }, mark()), null);
  assert.equal(dismissalFor(issue, []), null);
  assert.equal(dismissalFor(issue, undefined), null);
});

test('an edit higher up the file, which only moves the line, does not bring it back', () => {
  assert.ok(dismissalFor({ ...issue, locations: [{ file: 'a.py', line: 42 }, { file: 'b.py', line: 3 }] }, mark()));
});

test('it comes back when there is something new: another file, another finding in the file, or a change in severity', () => {
  assert.equal(dismissalFor({ ...issue, locations: [...issue.locations, { file: 'c.py', line: 1 }] }, mark()), null);
  assert.equal(dismissalFor({ ...issue, locations: [...issue.locations, { file: 'a.py', line: 99 }] }, mark()), null);
  assert.equal(dismissalFor({ ...issue, severity: 'medium' }, mark()), null);
  assert.ok(dismissalFor({ ...issue, locations: [issue.locations[0]] }, mark()), 'one going away is not new');
});

test('the summary leaves dismissed issues out but the issues stay listed', () => {
  const health = { summary: { high: 2, medium: 0, low: 0 }, issues: [issue, { id: 'other', severity: 'high', locations: [] }] };
  const out = withDismissed(health, mark());
  assert.deepEqual(out.summary, { high: 1, medium: 0, low: 0 });
  assert.equal(out.issues.length, 2);
  assert.equal(out.dismissed.length, 1);
  assert.deepEqual(withDismissed(health, 'nonsense').summary, { high: 2, medium: 0, low: 0 });
});

test('the page applies the same rule as the build', () => {
  const ui = fs.readFileSync(new URL('../skills/floorplan/assets/ui/20-health.js', import.meta.url), 'utf8');
  for (const piece of [`d.severity && d.severity !== issue.severity`, `String(loc).replace(/:[^:]*$/, '')`, `left.get(l.file) || 0`]) assert.ok(ui.includes(piece), piece);
});


// ---------- through the build and the export ----------
let root;
const NOTE = 'that value is only a sample, see the wiki';
const dataOf = (html) => JSON.parse(/<script>window\.FLOORPLAN = (.*?);<\/script>/s.exec(html)[1]);
const mapFile = (name) => path.join(root, 'floorplan', name);
const SERVE = path.join(REPO, 'skills', 'floorplan', 'assets', 'serve.mjs');
const exportPage = (include, file) => execFileSync(process.execPath, [SERVE, mapFile(''), '--export', file, '--include', include], { encoding: 'utf8' });

before(() => {
  root = shopApp();
  run('scan.mjs', root);
  run('build.mjs', root);
});
after(() => cleanup(root));

test('a dismissal marked "not a problem" survives a rebuild and leaves the counts; undoing it restores them', () => {
  const first = readGraph(root).health;
  const target = first.issues.find((i) => i.kind === 'secret');
  assert.ok(target && first.summary.high > 0);
  const rec = { id: target.id, severity: target.severity, locations: target.locations.map((l) => `${l.file}:${l.line}`), reason: NOTE };
  fs.writeFileSync(mapFile('health-dismissed.json'), JSON.stringify({ dismissed: [rec] }, null, 2) + '\n');

  const printed = run('build.mjs', root, '--artifact');
  const health = readGraph(root).health;
  assert.equal(health.summary.high, first.summary.high - 1);
  assert.equal(health.issues.length, first.issues.length, 'it stays listed');
  assert.equal(health.dismissed[0].reason, NOTE);
  assert.ok(!printed.includes(`[high] ${target.title}`), 'and the build report leaves it out');

  // reasons are notes to self: they stay on this computer
  assert.ok(!fs.readFileSync(mapFile('artifact.html'), 'utf8').includes(NOTE), 'not in the artifact copy');
  const exported = mapFile('copy.html');
  exportPage('health', exported);
  const page = fs.readFileSync(exported, 'utf8');
  assert.ok(!page.includes(NOTE), 'not in an exported copy');
  assert.equal(dataOf(page).health.dismissed[0].id, target.id, 'though the copy still sets the issue apart');
  const bare = mapFile('bare.html');
  exportPage('none', bare);
  assert.equal(dataOf(fs.readFileSync(bare, 'utf8')).health, undefined);

  fs.rmSync(mapFile('health-dismissed.json'));
  run('build.mjs', root);
  assert.deepEqual(readGraph(root).health.summary, first.summary);
  assert.equal(readGraph(root).health.dismissed, undefined);
});

test('a hand-broken dismissal file warns and does not break the map', () => {
  fs.writeFileSync(mapFile('health-dismissed.json'), '{ not json');
  assert.ok(run('build.mjs', root).includes('wrote'));
  assert.ok(readGraph(root).health.issues.length > 0);
  fs.rmSync(mapFile('health-dismissed.json'));
});