// The hardening this fork exists for, as three assertions the charter asks for by name:
//   (a) no non-localhost URL exists in any shipped script or asset — nor in a built map;
//   (b) no source spawns or execs 'claude' or 'codex' — no model-CLI execution anywhere;
//   (c) the waitlist/cloud phone-home symbols are absent for good.
// "Shipped" means skills/floorplan (the skill that lands in someone's project), minus the vendored layout
// engine (checksummed against npm byte for byte, license comments included). The one kind of address that
// remains is the SVG namespace identifier (http://www.w3.org/2000/svg): a name, never fetched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, SKILL, shopApp, scanAndBuild, cleanup } from './helpers.mjs';

const allFiles = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => path.join(e.parentPath ?? e.path, e.name));
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(REPO, f).replace(/\\/g, '/');
const shipped = allFiles(SKILL).filter((f) => !rel(f).includes('assets/vendor/') && /\.(mjs|js|html)$/.test(f));

// ---------- (a) no non-localhost URL in shipped scripts/assets ----------
const URL_RE = /https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org\/2000\/svg)/g;

test('(a) shipped scripts and assets carry no non-localhost URL', () => {
  for (const f of shipped) {
    const found = [...read(f).matchAll(URL_RE)];
    assert.deepEqual(found.map((m) => m[0]), [], `${rel(f)} carries a non-local address`);
  }
});

test('(a) a built map carries no non-localhost URL either', async () => {
  const root = shopApp();
  try {
    scanAndBuild(root);
    for (const name of ['graph.json', 'query.mjs']) {
      const file = path.join(root, 'floorplan', name);
      const found = [...read(file).matchAll(URL_RE)];
      assert.deepEqual(found.map((m) => m[0]), [], `floorplan/${name} carries a non-local address`);
    }
    // index.html inlines the vendored layout engine byte for byte (checksummed against npm in
    // supply-chain.test.mjs), whose EMF namespace identifiers and license notices name addresses nothing
    // ever fetches. Everything in the page besides that bundle is Floorplan's own code and data: strip
    // the bundle's script block and the page must be free of non-local addresses too.
    const { scriptBlocks } = await import(new URL('../skills/floorplan/assets/page-safety.mjs', import.meta.url));
    const html = read(path.join(root, 'floorplan', 'index.html'));
    const own = scriptBlocks(html).filter((b) => !/Eclipse Public License|org\.eclipse\.elk/.test(b.body));
    for (const b of own) {
      const found = [...b.body.matchAll(URL_RE)];
      assert.deepEqual(found.map((m) => m[0]), [], `floorplan/index.html (the page's own script) carries a non-local address`);
    }
    for (const part of [html.slice(0, scriptBlocks(html)[0]?.start ?? 0), html.slice((scriptBlocks(html).at(-1)?.end ?? 0))]) {
      const found = [...part.matchAll(URL_RE)];
      assert.deepEqual(found.map((m) => m[0]), [], `floorplan/index.html (outside its scripts) carries a non-local address`);
    }
    // and no reference that would load anything external
    assert.doesNotMatch(html, /<script[^>]*\ssrc=/i, 'no external scripts');
    assert.doesNotMatch(html, /<link[^>]*href=["']https?:/i, 'no external stylesheets or fonts');
    assert.doesNotMatch(html, /url\(\s*["']?https?:/i, 'no external images or fonts in CSS');
    // and the map needs no runtime server: the page's own code makes no requests of any kind, and its policy
    // forbids connecting anywhere at all (route paths in the scanned data may look like addresses; they are text)
    for (const piece of ['fetch(', 'EventSource', 'XMLHttpRequest', 'sendBeacon', 'WebSocket']) assert.ok(!html.includes(piece), `the page never uses ${piece}`);
    assert.match(html, /Content-Security-Policy[^>]*content="[^"]*connect-src 'none'/, "the page's policy forbids every connection");
    // the build places no server and no policy helper beside the map
    for (const gone of ['serve.mjs', 'page-safety.mjs']) assert.ok(!fs.existsSync(path.join(root, 'floorplan', gone)), `floorplan/${gone} is not written`);
  } finally { cleanup(root); }
});

// ---------- (b) no spawn or execFile of 'claude' or 'codex' ----------
// `claude` and `codex` may be words in prose and metadata (who built a map), but no program with either
// name is ever started, looked up, or given a command line — in the skill, the map, or the tools.
test('(b) no source spawns or execs a model CLI', () => {
  const roots = [SKILL, path.join(REPO, 'tools')];
  const files = roots.flatMap((r) => allFiles(r)).filter((f) => /\.(mjs|js|html)$/.test(f) && !rel(f).includes('assets/vendor/'));
  assert.ok(files.length > 30, 'found the source files');
  const patterns = [
    /\b(spawn|execFile(?:Sync)?)\s*\(\s*['"`][^'"`\n]*(?:claude|codex)/i,
    /\b(spawn|execFile(?:Sync)?)\s*\([^)\n]*['"`](?:claude|codex)['"`]\s*[,)]/i,
    /\bwhich\b\s*\(\s*['"`](?:claude|codex)['"`]/i,
    /['"`](?:claude|codex)['"`]\s*,\s*\[\s*\.\.\./i, // a resolved CLI's arguments assembled by name
    /--engine\s+claude|--engine\s+codex/,
    /claude\s+auth\s+status/,
  ];
  for (const f of files) {
    const src = read(f);
    for (const re of patterns) {
      const m = re.exec(src);
      assert.equal(m, null, `${rel(f)} starts a model CLI: ${m?.[0]}`);
    }
  }
});

// ---------- (c) waitlist/cloud symbols absent ----------
test('(c) no waitlist, cloud or phone-home symbol in the shipped files', () => {
  const SYMS = ['WAITLIST_URL', 'joinWaitlist', 'cloudPrompt', 'claudeEmail', 'saveCloud', '/api/cloud/', 'FloorplanCloud', '#cloud-card', 'cloud-card', 'floorplan-waitlist', 'FLOORPLAN_WAITLIST_URL', 'FLOORPLAN_NO_PROMPTS', 'Floorplan Cloud'];
  for (const f of allFiles(SKILL)) {
    if (/\.(png|woff2)$/.test(f)) continue;
    const src = read(f);
    for (const sym of SYMS) assert.ok(!src.includes(sym), `${rel(f)} still mentions ${sym}`);
  }
  // the map's page never posts anywhere, and no shipped script reads a settings file for cloud answers
  const serve = read(path.join(SKILL, 'assets', 'serve.mjs'));
  assert.ok(!serve.includes('settings.json'), 'no cloud settings file');
  assert.ok(!serve.includes('auth status'), 'no signed-in-account lookup');
});
