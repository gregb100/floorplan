// Release hygiene: the README badge and the changelog agree on the version, the skill is well-formed and
// everything it points at exists, and each release ships its fingerprints — so a release never ships
// half-bumped. (This fork ships a skill, not a plugin; the plugin manifests are gone.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, SKILL } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const version = /^## (\d+\.\d+\.\d+) \(/m.exec(read('CHANGELOG.md'))[1];

test('the README version badge matches the changelog', () => {
  assert.match(read('README.md'), new RegExp(`badge/version-${version.replaceAll('.', '\\.')}-`));
});

test('the changelog has a dated entry for this version', () => {
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${version.replaceAll('.', '\\.')} \\(\\d{4}-\\d{2}-\\d{2}\\)$`, 'm'));
});

test('the skill has a name and description, and every file it points to exists', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: floorplan\ndescription: .{50,}/);
  for (const [, ref] of skill.matchAll(/\]\((references\/[\w.-]+\.md)/g)) assert.ok(fs.existsSync(path.join(SKILL, ref)), ref);
  for (const [, script] of skill.matchAll(/scripts\/(\w+\.mjs)/g)) assert.ok(fs.existsSync(path.join(SKILL, 'scripts', script)), script);
});

test('CHECKSUMS.txt is for this version, so each release ships its fingerprints', () => {
  assert.match(read('CHECKSUMS.txt'), new RegExp(`^# Floorplan ${version.replaceAll('.', '\\.')}:`), 'run node tools/checksums.mjs when bumping the version');
});
