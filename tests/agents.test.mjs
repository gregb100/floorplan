// Claude Code and Codex: the skill notices which one is running it, and the map remembers, so its
// Ask bar and "Fix with …" prompts name the right one. Only Claude Code gets the CLAUDE.local.md note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lib, shopApp, run, readGraph, readJson, cleanup } from './helpers.mjs';

const { detectAgent } = await lib('agent.mjs');

