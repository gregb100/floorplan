<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.png">
  <img src="docs/images/logo-light.png" alt="Floorplan logo" height="88">
</picture>

# Floorplan

**See how your app actually fits together.**

A model reads your codebase and draws an interactive map of it. Every part, file and web request gets a plain-English name, and every connection between them is shown — in one self-contained HTML file that makes no network requests at all.

[![Tests](https://img.shields.io/github/actions/workflow/status/haydenschmitty/floorplan/test.yml?branch=main&style=flat-square&label=tests)](https://github.com/haydenschmitty/floorplan/actions/workflows/test.yml)
[![Version](https://img.shields.io/badge/version-0.12.0-111?style=flat-square)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%E2%89%A518-111?style=flat-square)](https://nodejs.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-111?style=flat-square)](#how-it-works)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Docs](docs/README.md) · [FAQ](#faq)

</div>

## Why Floorplan?

You built an app, probably with a lot of help from AI, and it works. But ask "what happens when someone checks out?" or "what breaks if I change this?" and the honest answer is *no idea*.

Floorplan gives you the diagram nobody drew: a zoomable map of your whole app — parts, files and endpoints, the screens, the requests between frontend and backend (even across repos), and outside services.

## Quick start

You need [Node.js 18+](https://nodejs.org) and an [OpenRouter](https://openrouter.ai) API key in `$OPENROUTER_API_KEY`.

```bash
node tools/fp.mjs run /path/to/your/project
```

That scans the project, plans its parts, names and describes every file and endpoint with a model through OpenRouter, and builds the map: `/path/to/your/project/floorplan/index.html`. Open that file in any browser — it's the whole map, offline, needing no server.

Useful commands:

```bash
node tools/fp.mjs scan <folder>                # just the scan
node tools/fp.mjs describe <folder>            # fill in what's missing (re-runnable)
node tools/fp.mjs update <folder>              # re-scan what changed, describe it, rebuild
node tools/fp.mjs status <folder>              # how complete the map is
node tools/fp.mjs run <folder> --dry-run       # print the prompts, call no model
node tools/fp.mjs run <folder> --max-calls 40  # stop cleanly after 40 model calls
```

Every model call is logged to `<project>/floorplan/.cache/run-log.jsonl` with its token counts and cost, and every run writes its steps to `driver-result.json` beside it. The driver writes only inside `<project>/floorplan/`, talks only to `openrouter.ai`, and never prints or logs your key.

## How it works

Scripts do the mechanical work — finding repos, parsing imports and routes in a dozen languages, matching web requests to the endpoints that answer them, laying out the map — as plain Node with no dependencies. A model does the part only a reader of the code can: deciding what the parts of your app *are*, and saying so plainly. The driver (`tools/fp.mjs`) wires the two together, with every model call checked against the schema the build expects and retried once when the answer doesn't pass.

The map itself is one self-contained HTML file: the layout engine ([ELK](https://eclipse.dev/elk/)) and fonts are built in, and the page carries a Content-Security-Policy that forbids every connection. Nothing shipped here makes an outbound request; the only network access is the driver's calls to `openrouter.ai`, with your key, when you run it.

**Languages:** TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Scala, Swift, C#, PHP, plus Vue, Svelte and Astro files and Shopify themes (Liquid), with lighter support for others.<br>
**Endpoints:** Express, Fastify, Koa, Hono, NestJS, Next.js, Firebase Cloud Functions, Supabase Edge Functions, Flask, FastAPI, Django, Go's net/http, Gin, Echo and chi, Actix, Axum, Spring, ASP.NET Core, Laravel, Serverless Framework (`serverless.yml`), `Bun.serve` and route tables in JavaScript and Python.<br>
**Screens:** Next.js, React Router, Vue, SvelteKit, Remix, Nuxt, Astro, Expo, Angular, TanStack, Shopify themes, Inertia.

## What it adds to your project

A `floorplan/` folder holding the map and its sources (`architecture.json`, `descriptions/`), all yours to edit. The folder ignores itself in git; nothing Floorplan makes is committed, and nothing outside the folder is touched.

## Privacy

- The scan, the build and the map all run on your computer. The map works offline: its layout engine and fonts are built in, and its policy forbids every network connection.
- No dependencies, no install scripts, no analytics, no tracking, no phone-home of any kind — enforced by tests on every change ([Is it safe to install?](docs/is-it-safe.md)).
- The model steps send worksheet excerpts of the mapped code (definitions, doc comments, endpoint handlers, small files) to `openrouter.ai`, under your key — that is the only thing that leaves your machine, and only when you run the driver. Use a key and model you trust with that content, and see [Privacy and security](docs/privacy-and-security.md).
- The Health check never stores or shows secret values, only where they are.

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | First map, updating, planning from a PRD, removing |
| [Using the map](docs/using-the-map.md) | Every button, view, shortcut and menu |
| [How it works](docs/how-it-works.md) | The pipeline, connection matching, refreshes |
| [What's in your project](docs/project-files.md) | Every file Floorplan creates, and how to edit it |
| [Privacy and security](docs/privacy-and-security.md) | What runs where, what leaves your machine |
| [Is it safe to install?](docs/is-it-safe.md) | Everything Floorplan does on your computer, and the tests that enforce it |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and fixes |
| [Running without an agent session](docs/unattended.md) | The JSON interface, exit codes and the workflow file |
| [Developing Floorplan](docs/development.md) | Repo layout, testing, releasing |

## FAQ

<details>
<summary><b>Does my code leave my computer?</b></summary>

Only when you run the model steps: worksheet excerpts of the mapped code (file names, definitions, doc comments, endpoint handlers, small files) go to `openrouter.ai`, under your key. Everything else — the scan, the build, the map — runs entirely on your machine, and the map's own policy forbids every network connection.

If you run the skill inside an agent session instead (this repository also ships as a skill), the same worksheets go to whatever agent you run it in, as with any other task you give it.
</details>

<details>
<summary><b>Does it need a server?</b></summary>

No. The map is one self-contained HTML file: open it directly, and it works offline. A small optional server (`skills/floorplan/assets/serve.mjs`) can serve the folder on `127.0.0.1` if you prefer a local address; it adds nothing to the page, and the page makes no requests of it.
</details>

<details>
<summary><b>How long does it take, and what does it cost?</b></summary>

A first map makes one model call for the plan and one per worksheet (three worksheets in parallel), so it depends on the size of your codebase. Every call's token counts and cost are written to `floorplan/.cache/run-log.jsonl`, and each run's total is printed and saved in `driver-result.json`. `--max-calls N` stops a run cleanly at any budget. Updates describe only what changed, so they're quick and cheap.
</details>

<details>
<summary><b>Will it change or commit my files?</b></summary>

It writes only its own `floorplan/` folder, and that folder ignores itself in git. It never changes your code, your `.gitignore` or any other tracked file.
</details>

<details>
<summary><b>The names it picked aren't how we talk about it. Can I change them?</b></summary>

Yes. Edit `floorplan/architecture.json` and `floorplan/descriptions/` yourself — they're yours. Your edits are kept on every update.
</details>

<details>
<summary><b>Does it work on monorepos and multi-repo setups?</b></summary>

Yes. Point it at a monorepo, a subfolder of one, or a plain folder that holds several repos side by side. It finds every repo and connects them.
</details>

## About this fork

This is a hardened fork of [haydenschmitty/floorplan](https://github.com/haydenschmitty/floorplan), maintained by [gregb100](https://github.com/gregb100) for private use. It removes everything that reaches off the machine — the waitlist and any other phone-home, all model-CLI execution (`claude`, `codex`), the plugin manifests, and the per-map server — and adds an unattended driver (`tools/fp.mjs`) that builds maps with any OpenRouter model. Tests enforce all of that on every change ([`tests/hardened.test.mjs`](tests/hardened.test.mjs), [`tests/supply-chain.test.mjs`](tests/supply-chain.test.mjs)). Upstream's work, and the idea, are Hayden Smith's; the bugs in this fork are ours.

## License

[MIT](LICENSE) © 2026 [Hayden Smith](https://github.com/haydenschmitty)