#!/usr/bin/env node
// tools/fp.mjs — the unattended floorplan driver: scan a codebase, plan it, describe it and build its map,
// with a model through OpenRouter. No Claude Code, no Codex, no other network.
//
// usage: node tools/fp.mjs <command> <repo> [flags]
//   scan <repo>        scan the codebase (floorplan/.cache/scan.json)
//   arch <repo>        write floorplan/architecture.json with the model, checked by build.mjs
//   build <repo>       build the map from architecture.json + descriptions
//   describe <repo>    fill in floorplan/descriptions/<key>.json, one model call per worksheet
//   run <repo>         scan → arch (only if missing) → build → describe → build
//   update <repo>      refresh what changed → describe what's new or flagged → build
//   status <repo>      print the map's state: described vs total, completeness, health, last run
//
// flags: --model <id>    the OpenRouter model (default qwen/qwen3.7-flash)
//        --dry-run       print every prompt and make no call
//        --max-calls N   stop cleanly, with a typed result, once N model calls have been made
//        --concurrency N describe worksheets in parallel, N at a time (default 3)
//
// Model access: HTTPS to https://openrouter.ai/api/v1/chat/completions only, key from $OPENROUTER_API_KEY
// (never printed, never logged). Every call appends one line to <repo>/floorplan/.cache/run-log.jsonl:
//   {ts, cmd, model, host, prompt_tokens, completion_tokens, cost_estimate_usd}
// (cost is OpenRouter's own measured spend for the call, when it reports one).
//
// Always unattended (FLOORPLAN_UNATTENDED=1): nothing is written outside <repo>/floorplan/. Every failure
// is typed and carries a written reason; the run's outcome is saved to floorplan/.cache/driver-result.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '..', 'skills', 'floorplan', 'scripts');
const REFERENCES = path.resolve(HERE, '..', 'skills', 'floorplan', 'references');
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'qwen/qwen3.7-flash';

// ---------- arguments ----------
const argv = process.argv.slice(2);
const COMMANDS = ['scan', 'arch', 'build', 'describe', 'run', 'update', 'status'];
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const has = (name) => argv.includes('--' + name);
const cmd = argv.find((a) => COMMANDS.includes(a));
const repoArg = argv.find((a, i) => !a.startsWith('--') && a !== cmd && !['--model', '--max-calls', '--concurrency'].includes(argv[i - 1]));
const usage = `usage: node tools/fp.mjs <${COMMANDS.join('|')}> <repo> [--model <id>] [--dry-run] [--max-calls N] [--concurrency N]`;
if (!cmd || !repoArg) { console.error(usage); process.exit(2); }
const repo = path.resolve(repoArg);
if (!fs.existsSync(repo)) { console.error(`✗ no such folder: ${repo}`); process.exit(2); }
const mapDir = path.join(repo, 'floorplan');
const cacheDir = path.join(mapDir, '.cache');
const model = opt('model', DEFAULT_MODEL);
const dryRun = has('dry-run');
const maxCalls = Number(opt('max-calls', Infinity));
const concurrency = Math.max(1, Number(opt('concurrency', 3)));
const runLog = path.join(cacheDir, 'run-log.jsonl');

// ---------- the skill's scripts, always unattended ----------
function runScript(name, ...args) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, name), repo, '--unattended', ...args], {
    encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: { ...process.env, FLOORPLAN_UNATTENDED: '1' },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr || '' };
}
const readJsonFile = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));

// ---------- typed results ----------
const steps = [];
let callsMade = 0, promptTokens = 0, completionTokens = 0, costTotal = 0;
function step(name, ok, detail) { steps.push({ step: name, ok, ...(detail ? { detail } : {}) }); }
/** How the run ended. `code` names the class of failure; the reason is always written down. */
async function finish(ok, code = null, message = null) {
  const result = {
    ts: new Date().toISOString(), cmd, repo, ok, ...(code ? { code } : {}), ...(message ? { message } : {}),
    calls: callsMade, tokens: { prompt: promptTokens, completion: completionTokens }, cost_usd: Number(costTotal.toFixed(6)),
    steps,
  };
  try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(path.join(cacheDir, 'driver-result.json'), JSON.stringify(result, null, 2) + '\n'); } catch {}
  console.log(`${ok ? '✓' : '✗'} fp ${cmd} ${repoArg}: ${ok ? 'done' : `${code}: ${message}`}`);
  console.log(`  model calls ${callsMade} · prompt tokens ${promptTokens} · completion tokens ${completionTokens} · cost $${costTotal.toFixed(4)}`);
  if (!ok) console.error(message);
  process.exit(ok ? 0 : 1);
}

// ---------- the model, through OpenRouter only ----------
let stopReason = null; // set when the call cap stops the run cleanly
function logCall(cmdName, usage) {
  promptTokens += usage.prompt_tokens || 0;
  completionTokens += usage.completion_tokens || 0;
  costTotal += usage.cost_estimate_usd || 0;
  callsMade++;
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.appendFileSync(runLog, JSON.stringify({ ts: new Date().toISOString(), cmd: cmdName, model, host: 'openrouter.ai', prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, cost_estimate_usd: usage.cost_estimate_usd ?? null }) + '\n');
  } catch {}
}
/** One model call. Returns the answer text, or throws { code, message }. */
async function askModel(cmdName, prompt, system) {
  if (callsMade >= maxCalls) { stopReason = { code: 'max_calls', message: `stopped at the --max-calls ${maxCalls} cap, with ${steps.length} step(s) done` }; throw stopReason; }
  if (dryRun) {
    callsMade++;
    console.log(`\n===== dry-run prompt (${cmdName}, ${prompt.length} chars) =====\n${prompt.slice(0, 4000)}${prompt.length > 4000 ? `\n… (+${prompt.length - 4000} chars)` : ''}`);
    return null; // callers treat null as "dry run: nothing to write"
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw { code: 'missing_key', message: 'OPENROUTER_API_KEY is not set; the model steps need it' };
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt },
        ] }),
        signal: AbortSignal.timeout(180000),
      });
      if (!r.ok) throw { code: 'model_http', message: `OpenRouter answered ${r.status}: ${(await r.text()).slice(0, 300)}` };
      const out = await r.json();
      const text = out?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw { code: 'model_empty', message: 'the model returned no text' };
      logCall(cmdName, { prompt_tokens: out.usage?.prompt_tokens, completion_tokens: out.usage?.completion_tokens, cost_estimate_usd: out.usage?.cost });
      return text;
    } catch (e) {
      if (e === stopReason || e?.name === 'AbortError' && false) throw e;
      if (e === stopReason) throw e;
      last = e?.code ? e : { code: 'model_network', message: e?.message || String(e) };
      if (attempt === 0) continue; // one retry on a network or HTTP hiccup
      throw last;
    }
  }
}
/** The model's answer parsed as JSON: fences stripped, first { to last }. */
function parseJsonAnswer(text) {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  for (const cand of [fence?.[1], text]) {
    if (!cand) continue;
    const a = cand.indexOf('{'), b = cand.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(cand.slice(a, b + 1)); } catch {} }
  }
  throw { code: 'invalid_json', message: 'the answer was not a JSON object' };
}

// ---------- secrets in what the model wrote ----------
const { maskSecrets } = await import(path.join(SCRIPTS, 'lib', 'health.mjs'));
const clean = (text) => maskSecrets(String(text ?? ''));

// ---------- prompt pieces ----------
const readHead = (file, lines) => { try { return fs.readFileSync(file, 'utf8').split('\n').slice(0, lines).join('\n'); } catch { return null; } };
/** What a person or README says about the repo, for the architecture prompt. */
function repoContext() {
  const parts = [];
  const readme = ['README.md', 'README.markdown', 'README', 'Readme.md'].map((n) => path.join(repo, n)).find(fs.existsSync);
  if (readme) parts.push(`README (top 200 lines):\n${readHead(readme, 200)}`);
  for (const pkgPath of (scan()?.repos || []).map((r) => path.join(repo, r.path, 'package.json'))) {
    try { const p = readJsonFile(pkgPath); if (p.description || p.scripts) parts.push(`${pkgPath}: ${JSON.stringify({ name: p.name, description: p.description, scripts: p.scripts })}`); } catch {}
  }
  return parts.join('\n\n');
}
let scanCache = null;
function scan() {
  if (scanCache !== null) return scanCache;
  try {
    const saved = readJsonFile(path.join(cacheDir, 'scan.json'));
    // the summary a model maps from lives in the --json result, not the saved scan; keep a copy beside it
    try { saved.summary = fs.readFileSync(path.join(cacheDir, 'scan-summary.md'), 'utf8'); } catch {}
    scanCache = saved;
  } catch { scanCache = null; }
  return scanCache;
}

// ---------- commands ----------
async function doScan() {
  const r = runScript('scan.mjs', '--json');
  if (r.code !== 0 || !r.json?.ok) return finish(false, 'scan_failed', `scan.mjs exited ${r.code}: ${(r.json?.errors || [r.stderr]).join('; ')}`);
  step('scan', true, `${r.json.counts?.files ?? '?'} files, ${r.json.counts?.routes ?? '?'} endpoints`);
  scanCache = r.json; // the stdout result carries the summary the saved scan.json does not
  try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(path.join(cacheDir, 'scan-summary.md'), r.json.summary || ''); } catch {}
  return r.json;
}

async function doBuild(when) {
  const r = runScript('build.mjs', '--json');
  if (r.code !== 0 || !r.json?.ok) {
    step(when, false, (r.json?.errors || [`build.mjs exited ${r.code}`]).join('; '));
    return r.json || { ok: false, errors: [r.stderr || `build.mjs exited ${r.code}`] };
  }
  step(when, true, `described ${r.json.descriptions.files.described}/${r.json.descriptions.files.total} files, ${r.json.descriptions.routes.described}/${r.json.descriptions.routes.total} routes`);
  return r.json;
}

const ARCH_SYSTEM = `You are the planning step of Floorplan, a tool that maps codebases. You read a scan summary and answer with ONE JSON object and nothing else: no prose, no markdown fences. The object is floorplan/architecture.json.`;
/** The architecture prompt: scan summary + README + the schema the answer must follow. */
function archPrompt(extra) {
  const s = scan();
  if (!s) return null;
  const schema = fs.readFileSync(path.join(REFERENCES, 'schema.md'), 'utf8');
  return [
    `Plan the parts of this codebase for its Floorplan map.`,
    `\n=== SCAN SUMMARY ===\n${s.summary}`,
    repoContext() ? `\n=== ABOUT THIS REPO ===\n${repoContext()}` : '',
    `\n=== HOW FILES GET ASSIGNED ===\nEvery included file goes to exactly one node: the deepest node whose paths glob matches it wins. Give nodes broad globs (a folder) and children narrower ones. Keep files no node claims under ~10%: cover every directory in the scan summary, and prefer a catch-all node ("Tests", "Scripts and tools", "Docs") over leaving files out. External nodes (databases, third-party APIs) own no files: claim them with packages/hosts instead.`,
    `\n=== THE SCHEMA YOUR JSON MUST FOLLOW ===\n${schema}`,
    `\n=== WHAT TO WRITE ===\n- project.name, project.summary (1–3 sentences, plain words), and no "entrypoints" unless the scan shows real entry files.`,
    `- nodes: 6–25 top-level and nested parts. Every node: id, label, kind, summary (one plain sentence), paths. Kind is one of ui, service, worker, library, feature, data, config, test, script, infra, external.`,
    `- Use "paths" globs relative to the repo root${(s.repos || []).length > 1 ? ' (a multi-repo root: paths start with the repo folder)' : ''}. A folder name alone matches the whole folder.`,
    `- You may add "ignore" for generated/vendored folders the scan lists, "edges" for connections static analysis can't see (queues, cron, webhooks), "flows" (2+ steps) and a 3–8 stop "tour".`,
    `- Write for the app's owner: everyday words, no framework names in labels or summaries.`,
    `\n=== ANSWER ===\nReturn only the JSON object.`,
    extra ? `\n=== YOUR LAST ANSWER DIDN'T PASS THE CHECKS ===\nFix these problems and return the whole JSON object again:\n${extra}` : '',
  ].filter(Boolean).join('\n');
}

/** arch: write architecture.json with the model, check it with build.mjs, retry once on failure. */
async function doArch(updateContext) {
  const archFile = path.join(mapDir, 'architecture.json');
  if (!updateContext && fs.existsSync(archFile)) { step('arch', true, 'architecture.json already exists'); return readJsonFile(archFile); }
  if (!scan()) { const s = await doScan(); if (!s) return null; }
  let lastReport = updateContext || null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = archPrompt(lastReport);
    if (!prompt) return finish(false, 'no_scan', 'no scan at floorplan/.cache/scan.json; run fp scan first');
    const answer = await askModel(attempt ? 'arch-retry' : 'arch', prompt, ARCH_SYSTEM);
    if (answer === null) { step('arch', true, 'dry run: prompt printed, nothing written'); return null; }
    let arch;
    try {
      arch = parseJsonAnswer(answer);
      if (!arch?.project?.name || !Array.isArray(arch.nodes) || !arch.nodes.length) throw new Error('project.name missing or nodes empty');
    } catch (e) {
      lastReport = e?.code === 'invalid_json' ? 'the answer was not a JSON object' : e.message;
      step(attempt ? 'arch-retry' : 'arch', false, lastReport);
      if (attempt === 0) continue;
      return finish(false, 'arch_invalid', `the model's architecture.json is not valid: ${lastReport}`);
    }
    fs.mkdirSync(mapDir, { recursive: true });
    fs.writeFileSync(archFile, JSON.stringify(arch, null, 2) + '\n');
    const b = runScript('build.mjs', '--json');
    const problems = (b.json?.errors || []).join('\n');
    const unassigned = b.json?.files?.unassignedPercent;
    if (b.json?.ok && unassigned <= 10) {
      step(attempt ? 'arch-retry' : 'arch', true, b.json.ok ? `build accepted it; ${unassigned}% unassigned` : '');
      return arch;
    }
    lastReport = `${problems || 'the build rejected the file'}${unassigned > 10 ? `\n${unassigned}% of files fall under no node's paths: add nodes or globs for the directories the report names.` : ''}\n\nBuild report:\n${(b.json?.report || b.stdout).slice(0, 4000)}`;
    step(attempt ? 'arch-retry' : 'arch', false, problems || `${unassigned}% unassigned`);
    if (attempt === 0) continue;
    // the retry also failed: the architecture on disk is the best we have, and the build says what's wrong
    if (b.json?.ok) { step('arch-retry', true, `accepted with ${unassigned}% unassigned`); return arch; }
    return finish(false, 'arch_invalid', `build.mjs rejects architecture.json: ${problems.split('\n')[0]}`);
  }
}

/** describe: fill in one worksheet's descriptions file. Retries once on a bad answer. */
async function fillWorksheet(ws) {
  const descFile = path.join(repo, ws.descriptions);
  const worksheet = fs.readFileSync(path.join(repo, ws.worksheet), 'utf8');
  let skeleton;
  try { skeleton = readJsonFile(descFile); } catch { skeleton = { files: {}, routes: {} }; }
  const keys = { files: Object.keys(skeleton.files || {}), routes: Object.keys(skeleton.routes || {}) };
  const prompt = [
    'Fill in the names and descriptions for one module of a codebase map.',
    `\n=== WORKSHEET ===\n${worksheet}`,
    `\n=== THE JSON TO FILL ===\nReturn ONE JSON object of exactly this shape, with the same keys and no others:\n${JSON.stringify({
      files: Object.fromEntries(keys.files.map((k) => [k, { name: skeleton.files[k]?.name || null, description: null }])),
      routes: Object.fromEntries(keys.routes.map((k) => [k, { name: skeleton.routes[k]?.name || null, description: null }])),
    })}`,
    `\nFill in every "description" (one sentence, verb first, under 140 characters, plain everyday words, what it does today — including saying plainly when it is a placeholder) and improve every "name" (2–5 words, sentence case). Do not change, add or remove keys. Return only the JSON object.`,
  ].join('\n');
  let lastProblem = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await askModel(attempt ? `describe-retry:${ws.key}` : `describe:${ws.key}`, prompt);
    if (answer === null) { step(`describe ${ws.key}`, true, 'dry run: prompt printed, nothing written'); return true; }
    let filled;
    try {
      filled = parseJsonAnswer(answer);
      const bad = [];
      for (const [group, which] of [['files', 'files'], ['routes', 'routes']]) {
        const got = Object.keys(filled[which] || {});
        if (got.length !== keys[which].length || !keys[which].every((k) => got.includes(k))) { bad.push(`${which}: keys changed (expected ${keys[which].length}, got ${got.length})`); continue; }
        for (const k of keys[which]) {
          const v = filled[which][k] || {};
          if (typeof v.name !== 'string' || !v.name.trim() || typeof v.description !== 'string' || !v.description.trim()) bad.push(`${which}[${JSON.stringify(k)}] needs a name and a description`);
        }
      }
      if (bad.length) throw new Error(bad.slice(0, 8).join('; '));
    } catch (e) {
      lastProblem = e?.code === 'invalid_json' ? 'the answer was not a JSON object' : e.message;
      if (attempt === 0) continue;
      step(`describe ${ws.key}`, false, lastProblem);
      failures.push({ worksheet: ws.key, reason: lastProblem });
      return false;
    }
    // keep what was already written, fill from the model's answer, mask secret-looking text before it lands
    const out = { files: {}, routes: {} };
    for (const k of keys.files) out.files[k] = { ...(skeleton.files[k] || {}), ...filled.files[k], name: clean(filled.files[k].name), description: clean(filled.files[k].description) };
    for (const k of keys.routes) out.routes[k] = { ...(skeleton.routes[k] || {}), ...filled.routes[k], name: clean(filled.routes[k].name), description: clean(filled.routes[k].description) };
    fs.mkdirSync(path.dirname(descFile), { recursive: true });
    fs.writeFileSync(descFile, JSON.stringify(out, null, 2) + '\n');
    step(`describe ${ws.key}`, true, `${keys.files.length} files, ${keys.routes.length} routes`);
    return true;
  }
}
const failures = [];

/** describe: every worksheet still missing descriptions, N at a time, resumable by re-running. */
async function doDescribe() {
  const r = runScript('describe.mjs', '--json');
  if (r.code !== 0 || !r.json?.ok) return finish(false, 'describe_failed', `describe.mjs exited ${r.code}: ${(r.json?.errors || [r.stderr]).join('; ')}`);
  if (r.json.nothingToDo) { step('describe', true, 'nothing to do: every file and route already has a description'); return true; }
  const list = r.json.worksheets;
  step('describe', true, `${list.length} worksheet(s) to fill, ${r.json.totals.files} files and ${r.json.totals.routes} routes still missing`);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length || stopReason) return;
      await fillWorksheet(list[i]);
    }
  });
  await Promise.all(workers);
  if (stopReason) return finish(false, stopReason.code, stopReason.message);
  if (failures.length) return finish(false, 'describe_invalid', `${failures.length} worksheet(s) came back unusable: ${failures.map((f) => `${f.worksheet} (${f.reason})`).join('; ')}. Re-run fp describe to try them again.`);
  return true;
}

async function doStatus() {
  const s = runScript('status.mjs', '--json');
  const state = s.json?.state ?? 'none';
  const lines = [`state: ${state}`];
  if (['map', 'blueprint', 'blueprint-started'].includes(state)) {
    const b = runScript('build.mjs', '--check', '--json');
    if (b.json?.ok) {
      const d = b.json.descriptions;
      lines.push(`described: files ${d.files.described}/${d.files.total} · routes ${d.routes.described}/${d.routes.total} · complete ${d.complete}`);
      if (b.json.health) lines.push(`health: ${b.json.health.high} important · ${b.json.health.medium} worth fixing · ${b.json.health.low} minor`);
      if (s.json?.builtAt) lines.push(`built: ${s.json.builtAt}`);
    } else {
      lines.push(`build: ${(b.json?.errors || ['would not build']).join('; ')}`);
    }
  }
  try {
    const log = fs.readFileSync(runLog, 'utf8').trim().split('\n');
    const last = JSON.parse(log[log.length - 1]);
    const calls = log.length;
    const tokens = log.reduce((a, l) => { const e = JSON.parse(l); return { prompt: a.prompt + (e.prompt_tokens || 0), completion: a.completion + (e.completion_tokens || 0), cost: a.cost + (e.cost_estimate_usd || 0) }; }, { prompt: 0, completion: 0, cost: 0 });
    lines.push(`last run: ${calls} model call(s) · prompt ${tokens.prompt} · completion ${tokens.completion} · $${tokens.cost.toFixed(4)}`);
  } catch { lines.push('last run: none'); }
  console.log(lines.join('\n'));
  step('status', true, state);
  return finish(true);
}

// ---------- the command dispatch ----------
try {
  if (cmd === 'scan') {
    const s = await doScan();
    if (s) await finish(true);
  } else if (cmd === 'arch') {
    await doArch();
    await finish(true);
  } else if (cmd === 'build') {
    const b = await doBuild('build');
    await finish(!!b?.ok, b?.ok ? null : 'build_failed', (b?.errors || []).join('; '));
  } else if (cmd === 'describe') {
    await doDescribe();
    await finish(true);
  } else if (cmd === 'status') {
    await doStatus();
  } else if (cmd === 'run') {
    if (!(await doScan())) process.exit(1);
    if (!fs.existsSync(path.join(mapDir, 'architecture.json'))) {
      await doArch();
      if (stopReason) await finish(false, stopReason.code, stopReason.message);
    } else step('arch', true, 'architecture.json already exists');
    const b1 = await doBuild('build (first)');
    if (!b1?.ok) await finish(false, 'build_failed', (b1?.errors || []).join('; '));
    await doDescribe();
    const b2 = await doBuild('build (final)');
    if (!b2?.ok) await finish(false, 'build_failed', (b2?.errors || []).join('; '));
    const d = b2.descriptions;
    await finish(d.complete, d.complete ? null : 'incomplete', d.complete ? null : `${d.files.total - d.files.described} file(s) and ${d.routes.total - d.routes.described} route(s) still lack descriptions; re-run fp describe to finish them`);
  } else if (cmd === 'update') {
    const r = runScript('refresh.mjs', '--json');
    if (r.code !== 0 || !r.json?.ok) await finish(false, 'refresh_failed', `refresh.mjs exited ${r.code}: ${(r.json?.errors || [r.stderr]).join('; ')}`);
    if (r.json.map === false) await finish(false, 'no_map', 'no map to update; run fp run first');
    step('refresh', true, `${(r.json.changes?.files?.new || 0)} new, ${(r.json.changes?.files?.edited || 0)} edited, ${(r.json.descriptions?.flagged || 0)} flagged`);
    const next = (r.json.next || []).map((n) => n.code);
    if (next.includes('first_map')) await finish(false, 'no_map', 'no map here yet; run fp run first');
    if (next.some((c) => ['fix_build', 'assign_new_files', 'review_structure'].includes(c))) {
      await doArch(`Update floorplan/architecture.json for the changes below. Keep every node that still exists; add or widen paths for new files; remove nothing that still matches.\n\n${(r.json.report || '').slice(0, 3000)}`);
      if (stopReason) await finish(false, stopReason.code, stopReason.message);
    }
    if (next.some((c) => ['describe', 'fix_build', 'assign_new_files', 'review_structure'].includes(c))) await doDescribe();
    const b = await doBuild('build');
    if (!b?.ok) await finish(false, 'build_failed', (b?.errors || []).join('; '));
    await finish(b.descriptions.complete, b.descriptions.complete ? null : 'incomplete', b.descriptions.complete ? null : `${b.descriptions.files.total - b.descriptions.files.described} file(s) still lack descriptions; re-run fp describe`);
  }
} catch (e) {
  if (stopReason) await finish(false, stopReason.code, stopReason.message);
  await finish(false, e?.code || 'unexpected', e?.message || String(e));
}
