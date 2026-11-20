# Troubleshooting

### `fp arch` or `fp describe` fails with "OPENROUTER_API_KEY is not set"
The model steps need an [OpenRouter](https://openrouter.ai) key. Set it for the session:

```bash
export OPENROUTER_API_KEY=sk-or-...
```

(In Windows PowerShell: `$env:OPENROUTER_API_KEY = "sk-or-..."`.) The key is never printed or logged; only token counts and cost are, in `floorplan/.cache/run-log.jsonl`.

### A model call failed, or OpenRouter answered an error
The driver retries each call once on a network or HTTP hiccup, then stops with a typed reason (in `floorplan/.cache/driver-result.json`). `fp arch` and `fp describe` are resumable: fix the cause (quota, key, model name) and run the same command again; what already succeeded is kept. `--max-calls N` stops a run early, cleanly, so you can inspect cost as you go.

### A model's answer came back unusable
`fp arch` sends the build's errors back to the model once and rebuilds; `fp describe` does the same per worksheet. If a worksheet still comes back wrong, `fp describe` stops naming it and its reason. Run `fp describe` again to retry only what's missing.

### `node` isn't recognized
Install [Node.js](https://nodejs.org) 18 or newer.

### The map looks out of date
Run `node tools/fp.mjs update <project>`. If a tab was already open, reload it: the page makes no requests, so nothing updates on its own.

### The map is blank, or stuck on "Laying out"
The map needs nothing from the internet — its layout engine and fonts are built into the file — so check the file finished writing (the build prints `✓ wrote floorplan/index.html`). An old map from upstream Floorplan 0.1.2 or earlier loaded its layout engine from the network; rebuild with this fork.

### A connection is missing
Floorplan finds most web requests and imports by reading the code, but not all — requests to an address that only exists in settings, for instance. Add it as an explicit edge in `floorplan/architecture.json` (see [the schema](../skills/floorplan/references/schema.md)), and it stays on every update.

### A file is in the wrong part, or under "Unassigned"
Edit the `paths` patterns in `floorplan/architecture.json` and rebuild. The build's report names which directories are unassigned.

### A repo is missing from the map, or the scan lists PROBLEMS
The scan lists each repo git couldn't list files for, with the likely fix. The usual causes:
- **git isn't installed**, or isn't on the PATH of whatever runs Floorplan;
- **"dubious ownership"**: git refuses a checkout owned by a different user, common in containers and shared folders. Mark it safe with `git config --global --add safe.directory <folder>`, then scan again.

The driver runs unattended, where a repo git can't list is an error, so a map with a repo missing can't slip through.

### "floorplan/ already exists here and isn't a map"
Your project has its own folder called `floorplan`, which Floorplan won't write into. Rename your folder; the scan and build scripts accept `--out <folder>`.

### `git status` shows files under `floorplan/`
They were committed before Floorplan started ignoring the folder. Untrack them, keeping the files on disk:

```bash
git rm -r --cached floorplan
```

### Port 4378 is in use
Nothing to do: `serve.mjs` moves to the next free port and prints the address it chose.

### Stopping the local server

```bash
node skills/floorplan/assets/serve.mjs <project>/floorplan --stop
```

(The map needs no server at all; this is only for the nicer local address.)

### Still stuck?
[Open an issue](https://github.com/haydenschmitty/floorplan/issues/new/choose) with what you ran, what happened, and the output it showed. Please leave out anything private from your code.