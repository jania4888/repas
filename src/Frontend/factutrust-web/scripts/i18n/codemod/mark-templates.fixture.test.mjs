#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtureDir = path.join(root, 'codemod', 'fixtures');
const sample = path.join(fixtureDir, 'sample.html');
const backup = path.join(fixtureDir, 'sample.html.bak');

const original = fs.readFileSync(sample, 'utf8');
fs.writeFileSync(backup, original, 'utf8');

const run = spawnSync(process.execPath, ['mark-templates.mjs', fixtureDir], {
  cwd: path.join(root, 'codemod'),
  encoding: 'utf8'
});
assert.equal(run.status, 0, run.stderr || run.stdout);

const updated = fs.readFileSync(sample, 'utf8');
assert.match(updated, /i18n/);
assert.match(updated, /i18n-placeholder/);
assert.match(updated, /<ng-container i18n>Type d'obligation<\/ng-container>/);
assert.match(updated, /@if \(x < 4\)/);
assert.doesNotMatch(updated, /ng-container i18n>@if/);

const second = spawnSync(process.execPath, ['mark-templates.mjs', fixtureDir], {
  cwd: path.join(root, 'codemod'),
  encoding: 'utf8'
});
assert.equal(second.status, 0, second.stderr || second.stdout);
assert.equal(fs.readFileSync(sample, 'utf8'), updated, 'second pass must be idempotent');

fs.writeFileSync(sample, original, 'utf8');
fs.unlinkSync(backup);
console.log('mark-templates fixture OK');
