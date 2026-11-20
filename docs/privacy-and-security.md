# Privacy and security

For what the skill itself can and can't do on your computer (no hooks, MCP servers, dependencies, downloads or phone-home, and how to verify your copy), see [Is it safe to install?](is-it-safe.md).

## What runs where

| Part | Where it runs | What it sends |
|---|---|---|
| Scan, build, updates, refresh | your computer (Node.js) | nothing |
| Writing names and descriptions (the driver) | a model you pick, through OpenRouter, with your key | the worksheet for each part: file names, definitions, doc comments, the code of each endpoint, and short excerpts of very small files, plus README text. `tools/fp.mjs` talks to `openrouter.ai` and nothing else, and logs each call's token counts and cost to `floorplan/.cache/run-log.jsonl` (never your key) |
| Writing names and descriptions (an agent session) | the agent you run the skill in | the files it reads, the same as any other task you give it |
| The map | your browser | nothing. Its layout engine and fonts are bundled into the file, so it works offline, and its policy forbids every connection |
| The optional local server (`assets/serve.mjs`) | your computer, listening on `127.0.0.1` only | nothing on its own; it serves the map folder, unchanged |
| Exporting a copy | your computer: one command writes one HTML file | nothing. You decide who gets the file. It holds the map, plus Health or recent work only if you ask for them, and never your folder path, git remotes or source code |

Floorplan has no analytics or telemetry, no dependencies to install, no install scripts, and no outbound connections of any kind. The only thing that ever leaves your machine is what you send to the model, deliberately, when you run the driver — and the driver reaches one host: `openrouter.ai`.

The layout engine ([elkjs](https://github.com/kieler/elkjs) 0.9.3, EPL-2.0) and fonts (Inter and JetBrains Mono, SIL Open Font License) are bundled in `skills/floorplan/assets/vendor/` with their licenses, and every build copies them into the map.

## The local server

The server is optional: the map is a self-contained HTML file you can open directly. If you prefer a local address, `node skills/floorplan/assets/serve.mjs <map folder>` serves it:

- It listens on `127.0.0.1` only, so other machines on your network can't reach it.
- It answers only to `127.0.0.1` and `localhost` at its own port, so a website that points its own domain at your computer (DNS rebinding) can't load the map.
- It serves files from the map folder only, and what it serves is byte for byte the file on disk — nothing is added to the page, and the page makes no requests of it (or of anything).
- `node skills/floorplan/assets/serve.mjs <map folder> --stop` stops a running one.

## Secrets

The Health check looks for passwords, API keys and private keys in your code, and for `.env` files that would be committed. When it finds one, it records only the file, the line, the kind of secret, and a masked hint like "starts AKIA…, 20 characters". **Secret values are never stored in the map, printed, or sent anywhere.**

Text written about your code is checked too. If a description, label, summary, note or recent-work entry (in `architecture.json`, `descriptions/`, `recent-work.json` and the other files in `floorplan/`), or a comment the scan picked up, holds something that looks like a secret, the build puts it in the map as «hidden» and warns, naming the file and the field but never the value, so you can take it out. The driver runs the same check (`maskSecrets`) on every name and description before it writes the model's answer to disk. Your files are left as they are. It looks for well-known key formats, passwords in database addresses, quoted values given a secret-sounding name, `NAME=value` settings, and long generated-looking strings; ordinary words, file paths, commit hashes and IDs are left alone.

The check is a helpful first pass, not a security audit. And note the honest limit of the driver: worksheet excerpts of the mapped code go to the model, so a secret in a very small file or an endpoint's handler may reach the model even though its value is masked in what Floorplan writes back. Don't map repositories holding secrets you can't afford to send.

## Maps of code you didn't write

A map shows text Floorplan didn't write: file names, endpoint paths and comments from the code, and descriptions written by a model or a person. All of it is treated as text, never as part of the page: it's escaped wherever it's shown, it goes into the page's data in a form the browser can't mistake for markup, and characters that are invisible or reverse the text around them (which can make one file name read as another) are shown as a visible marker such as `[U+202E]`. Every map carries a Content-Security-Policy that lets only its own scripts run and forbids every connection (see [Is it safe to install?](is-it-safe.md#the-network)). A pattern in `architecture.json` that isn't valid is reported as a build error, and the scan skips config files over 1 MB and reads large files without slowing down.

## Git

Nothing Floorplan creates is committed. See [What's in your project](project-files.md#staying-out-of-git).

## Reporting a vulnerability

Please report security problems privately, as described in [SECURITY.md](../SECURITY.md), rather than in a public issue.
