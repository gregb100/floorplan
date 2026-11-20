# Developing Floorplan

## Repo layout

```
skills/floorplan/
  SKILL.md             the workflow an agent session follows
  workflow.json        the same steps as SKILL.md, as data, for running without an agent session
  references/          formats and style guides the agent (or you) reads while working
    schema.md                architecture.json and recent-work.json
    choosing-boundaries.md   how to carve a codebase into a good map
    writing-descriptions.md  plain-language names and descriptions
    blueprint.md             plan.json, for a map planned from a PRD
  scripts/             Node.js, no dependencies
    status.mjs     is there a map, and how stale is it
    scan.mjs       repos, files, imports, endpoints, requests → .cache/scan.json
    plan.mjs       a blueprint's plan.json → the same .cache/scan.json
    build.mjs      validate, assign files, connect, Health, screens → graph.json + index.html + query.mjs
    describe.mjs   worksheets for naming and describing files and endpoints
    refresh.mjs    incremental update: re-scan, carry over, flag changes, rebuild
    recent.mjs     facts for marking recent work
    open.mjs       open floorplan/index.html in the browser (no server needed)
    lib/           extraction, import resolution, Nuxt auto-imports, route matching, Health, screens, helpers
  assets/
    viewer.html    the map (template the build fills in)
    ui/            viewer extensions: Theme button, blueprints, glossary, Health, recent work, screens, tour
    graph-query.js shared map lookups (viewer and query.mjs)
    serve.mjs      optional: serves a built map folder on 127.0.0.1, and exports a copy to share
    page-safety.mjs  the one way data and code go into a page's <script> blocks, and its Content-Security-Policy
    query-cli.mjs  becomes floorplan/query.mjs
    logo.png, favicon.png
    vendor/        bundled layout engine (elkjs) and fonts, with their licenses
tests/                 regression tests and the sample projects they map
tools/fp.mjs           the unattended driver: scan → arch → build → describe → build, through OpenRouter
tools/checksums.mjs    writes CHECKSUMS.txt for a release, and checks a copy against it
CHECKSUMS.txt          SHA-256 of every file the skill runs from, as of the last release
docs/                  these guides
```

This fork of Floorplan ships the skill, not a plugin: the `claude`, `codex` and `.agents` plugin manifests are gone, no model CLI is ever started, and nothing shipped makes an outbound request. [`tests/supply-chain.test.mjs`](../tests/supply-chain.test.mjs) and [`tests/hardened.test.mjs`](../tests/hardened.test.mjs) hold that line.

## Running it

The scripts run on their own, which is the fastest way to work on them:

```bash
node skills/floorplan/scripts/scan.mjs /path/to/project
node skills/floorplan/scripts/build.mjs /path/to/project
node skills/floorplan/scripts/open.mjs /path/to/project
```

The full pipeline, with a model doing the planning and describing:

```bash
export OPENROUTER_API_KEY=sk-or-...
node tools/fp.mjs run /path/to/project            # scan → arch → build → describe → build
node tools/fp.mjs arch /path/to/project --dry-run # print the prompt, call nothing
```

`fp.mjs` logs each model call to the project's `floorplan/.cache/run-log.jsonl` and each run's steps to `driver-result.json` beside it.

## Tests

```bash
npm test                          # the whole suite (node --test)
node --test tests/hardened.test.mjs tests/supply-chain.test.mjs
```

The suite maps sample projects into temp folders and builds real maps, so it exercises the build, the hardened page (no requests, no external addresses, no CLI spawns) and the driver's contract with the scripts.

## Releasing

1. Bump the version: the changelog's top `## x.y.z (date)` heading, the README badge and `CHECKSUMS.txt` all name it, and [`tests/release.test.mjs`](../tests/release.test.mjs) fails until they agree.
2. Run `node tools/checksums.mjs` to write `CHECKSUMS.txt` (SHA-256 of every file the skill runs from).
3. `npm test` green.