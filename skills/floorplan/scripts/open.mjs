#!/usr/bin/env node
// Show the map to the user after a build or refresh. The map is a self-contained HTML file, so this opens
// it directly in the browser — no server to start or stop. Prints the path.
// usage: node open.mjs [root] [--no-open]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, mapDir, unattendedMode } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args._[0] || '.');
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/') || '.';
// unattended: nobody is there to look, so open nothing
if (unattendedMode(args)) {
  console.log("Unattended mode: not opening a browser. The map is floorplan/index.html; open it in any browser.");
  process.exit(0);
}
const file = path.join(mapDir(root), 'index.html');
if (!fs.existsSync(file)) {
  console.error('✗ No built map here yet. Run build.mjs first.');
  process.exit(1);
}

function openBrowser(u) {
  const [cmd, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', u]] : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
  try { spawn(cmd, a, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); return true; } catch { return false; }
}

const url = `file://${process.platform === 'win32' ? '/' + path.resolve(file).replace(/\\/g, '/') : path.resolve(file)}`;
const shown = args['no-open'] ? 'not opened in a browser (--no-open): open the file yourself'
  : openBrowser(url) ? 'opened in the browser' : `could not open a browser: open ${rel(file)} yourself`;
console.log(`FLOORPLAN  ${rel(file)}  (${shown})`);
