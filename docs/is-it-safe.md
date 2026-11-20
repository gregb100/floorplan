# Is it safe to install?

Tools that read your code deserve the question. Floorplan is built so it can't phone home, can't run a model CLI, and can't download anything — a test checks all of that on every change, and you can confirm it yourself.

## What Floorplan never does

- **No hooks.** Hooks run code automatically on events in every session, which makes them a common hiding place. Floorplan has none.
- **No MCP servers.** Floorplan has none, so it never starts a server that downloads its newest version with `npx`.
- **No dependencies, no install scripts.** Nothing comes from npm, at install time or ever. Its `package.json` exists only to run the tests.
- **Never downloads anything, and never runs code from the internet.** No `eval`, no loading code at run time, no encoded payloads.
- **Never reaches the network.** Nothing Floorplan ships makes an outbound connection of any kind — no fetch, no event stream, no analytics, no waitlist, no phone-home. The only network access in this repository is the driver (`tools/fp.mjs`), which you run deliberately and which talks to one host: `openrouter.ai`, to the model you pick, with your own key.
- **Never runs a model CLI.** This fork does not start `claude`, `codex`, or any other coding agent, ever. A test fails if either one is ever named as a program to run.
- **Never changes your code.** It writes only its own `floorplan/` folder.

## Everything it does

### The network

- **Nothing, from the skill or the map.** The map page makes no requests at all: it enforces that itself with a Content-Security-Policy that allows only its own scripts (each allowed by its SHA-256 hash, computed when the page is written), images and fonts only from inside the file, and `connect-src 'none'` — no connection to anywhere, including a local server. The map needs no server; it is one self-contained HTML file.
- **A local server is optional.** `skills/floorplan/assets/serve.mjs` will serve a built map's folder on `127.0.0.1` if you want a tidy address instead of opening the file. It accepts only `127.0.0.1` and `localhost` at its own port (so a website pointing its domain at your machine — DNS rebinding — is refused), serves files from the map folder only, and adds nothing to the page: what it serves is byte for byte the file on disk. Exporting a copy to share is a command against that folder, not a running service.
- **The driver (`tools/fp.mjs`)** makes HTTPS calls to `https://openrouter.ai/api/v1/chat/completions` only, with `$OPENROUTER_API_KEY` (which is never printed or logged). Each call appends one line to `<repo>/floorplan/.cache/run-log.jsonl`: a timestamp, the command, the model, prompt and completion token counts, and OpenRouter's own measured cost for the call. The worksheet and architecture prompts contain code excerpts and README text from the repo being mapped — that is the point of the tool — so use a model and account you trust with that content, and don't map repositories holding secrets you can't afford to send.

### The programs it runs

| Program | When | Why |
|---|---|---|
| `git` | scan | Read-only: which files are tracked, the current branch and commit, what changed since the last map |
| `node` | throughout | Running Floorplan's own scripts (including, in unattended runs it starts, the scan and build scripts) |
| `cmd /c start`, `open` or `xdg-open` | opening the map | Opening the map's local address or file in your browser |

That is the whole list. Each is started directly with its arguments, never as a command line for a shell to interpret. The one shell is Windows' `cmd /c start`, given only the map's own local address. No `claude`, no `codex`, no `where`/`which` lookups, no plugins to any of them.

### What runs without asking

In an agent session, while the skill is in use, it pre-approves one kind of command: `node` running one of its own scripts, each named exactly (`scripts/build.mjs`, `describe.mjs`, `open.mjs`, `plan.mjs`, `recent.mjs`, `refresh.mjs`, `scan.mjs` and `status.mjs`). That list is fixed by the tests below. Anything else asks according to your permission settings, as usual.

### The workflow file

`skills/floorplan/workflow.json` is data, not code: the same steps as SKILL.md, for people who run Floorplan from their own scripts or CI ([Running without an agent session](unattended.md)). Nothing in Floorplan reads it to decide what to run.

### Two things worth explaining

- **`skills/floorplan/assets/vendor/elk.bundled.js`** is a 1.6 MB minified file: the layout engine that arranges the map. It's [elkjs](https://github.com/kieler/elkjs) 0.9.3, byte for byte the same as the official package on npm. Its SHA-256 is `b0745abd7f23cd91690a1587e377edbe19fd7233c783300290936720546216d4`. (Its license notices and internal namespace identifiers name web addresses; they are names in comments and string constants, never fetched.) To check it yourself:
  ```bash
  npm pack elkjs@0.9.3
  tar -xzf elkjs-0.9.3.tgz package/lib/elk.bundled.js
  ```
  Then compare `package/lib/elk.bundled.js` with Floorplan's copy, for example with `sha256sum` (macOS: `shasum -a 256`; Windows PowerShell: `Get-FileHash`).
- **Health reads the middle part of tokens it finds** (it decodes them from base64) to tell what kind of token each is, so it can skip ones that are public by design. It never stores or shows the token itself.

## Checked on every change

[`tests/supply-chain.test.mjs`](../tests/supply-chain.test.mjs) and [`tests/hardened.test.mjs`](../tests/hardened.test.mjs) run on every push and pull request. They fail if a change would:

- add a hook, an MCP server, a plugin manifest, a dependency or an install script;
- make an outbound request anywhere, from the scripts or from the page (including the waitlist and any other phone-home: those symbols are gone and must stay gone);
- start a program not in the table above, or start one through a shell;
- spawn or exec a model CLI (`claude`, `codex`), or name either one as a program to run;
- carry a non-localhost URL in any shipped script or asset (or a built map), beyond the SVG namespace identifier and the vendored layout engine's notices;
- write a server or anything else executable beside the map;
- use `eval`, load code at run time, or hide a long encoded string in the code;
- change the bundled layout engine, or add a vendored file.

Each check was tested by planting exactly that kind of change and seeing it fail. A change to any of this has to change the test and this page together, in the open.

To run the same checks on your own copy:

```bash
node --test tests/supply-chain.test.mjs tests/hardened.test.mjs
```

## Check that your copy is a real release

Every release includes `CHECKSUMS.txt`: a SHA-256 fingerprint of every file the skill runs from. To compare your copy with the release:

```bash
node tools/checksums.mjs --check <your floorplan checkout>
```

It prints either that all files are identical, or which ones changed, are extra or are missing.

## The honest limits

- The model steps (architecture, descriptions) send code excerpts from the mapped repository to OpenRouter, under your key. That is the only thing that leaves your machine, and only when you run the driver. Map repositories accordingly.
- Floorplan works by having a model read your code to describe it. Use an account and model you trust with that content, like any other AI-assisted task.

## Found something?

Please report it privately, as described in the [security policy](../SECURITY.md).
