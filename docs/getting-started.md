# Getting started

Floorplan maps a codebase: it scans the files, imports, endpoints and web requests, a model names the parts and describes every file, and the result is one self-contained HTML page you can open anywhere.

Floorplan runs on **Node.js 18 or newer** (check with `node --version`) and, for the model steps, an **[OpenRouter](https://openrouter.ai) API key** in `$OPENROUTER_API_KEY`.

## Make your first map

From a checkout of this repository:

```bash
node tools/fp.mjs run <your project's folder>
```

That scans the project, plans its parts, describes every file and endpoint, and builds the map: `<project>/floorplan/index.html`. Run it on a folder that holds several repos side by side and it maps them together, connecting the requests between them.

What happens, step by step:

- A scan lists every file, import, endpoint and web request. This takes seconds and costs no tokens.
- The model reads the scan summary, the README and entry points, then decides the main parts of your app and what each one is for — and the build checks its answer.
- A worksheet per part goes back to the model: file names, definitions, doc comments, what each file uses and who uses it, and the code of every endpoint. It answers with a plain-language name and a one-line description for every file and endpoint. (Worksheets are filled three at a time.)
- The map is built and checked: connections, Health issues and screens.

Every model call is logged to `<project>/floorplan/.cache/run-log.jsonl` with its token counts and cost, and every step's outcome to `driver-result.json` in the same folder.

Useful variations:

```bash
node tools/fp.mjs scan <folder>                 # just the scan (floorplan/.cache/scan.json)
node tools/fp.mjs arch <folder> --dry-run       # print the planning prompt, call nothing
node tools/fp.mjs describe <folder>             # fill in only what's missing (re-runnable)
node tools/fp.mjs status <folder>               # how complete the map is
node tools/fp.mjs run <folder> --max-calls 40   # stop cleanly after 40 model calls
node tools/fp.mjs run <folder> --model qwen/qwen3.7-flash
```

The driver writes only inside `<project>/floorplan/` (unattended mode), talks only to `openrouter.ai`, and never prints or logs your key.

## Look around

Open `<project>/floorplan/index.html` in any browser — that's the whole map, fonts and layout engine included, no server and no internet. Or open it via a local address:

```bash
node skills/floorplan/scripts/open.mjs <project>
```

The one-minute **Start here** tour runs the first time you open it.

See [Using the map](using-the-map.md) for everything you can do on it.

## Keep it up to date

After you've worked on the code:

```bash
node tools/fp.mjs update <project>
```

Floorplan re-scans and compares with the last map. Moved files keep their descriptions, deleted ones disappear, and only what's new or changed in purpose goes back to the model — so updates are quick.

## Plan something you haven't built yet

Floorplan's main job is mapping code that exists. It can also draw a **blueprint** from a PRD, a spec or a description: share the document in your agent session and ask it to make a floorplan of what you'd need to build. Every part, file, endpoint and screen the app would need, how they connect, and the outside services they rely on — with dashed cards so you can tell it's a plan. Once the code exists, `refresh.mjs --from-code` maps the real thing and the blueprint retires.

## Open the map yourself

The map is a folder in your project. Either open `floorplan/index.html` directly — it needs no server — or serve it on a local address:

```bash
node skills/floorplan/assets/serve.mjs <project>/floorplan
```

It listens on `127.0.0.1` only, serves the map folder unchanged, and adds nothing to the page. To stop a running one:

```bash
node skills/floorplan/assets/serve.mjs <project>/floorplan --stop
```

To share a map, export a copy — one HTML file with none of your computer's details in it:

```bash
node skills/floorplan/assets/serve.mjs <project>/floorplan --export
```

## Remove it

Delete the `floorplan/` folder from any project you mapped. Nothing else was touched, and nothing was ever committed.