import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'mark-templates.mjs');
const beforeFixture = join(here, 'fixtures', 'mark-templates-before.html');
const afterFixture = join(here, 'fixtures', 'mark-templates-after.html');
const fixturesDir = join(here, 'fixtures');

function runCodemod(targetDir, check = false) {
  const args = [script, targetDir];
  if (check) args.push('--check');
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
}

let tempRoot;
after(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test('mark-templates transforms before fixture to after fixture', () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'mark-templates-spec-'));
  const target = join(tempRoot, 'sample.html');
  copyFileSync(beforeFixture, target);
  const first = runCodemod(tempRoot);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const output = readFileSync(target, 'utf8');
  const expected = readFileSync(afterFixture, 'utf8');
  assert.equal(output, expected);
});

test('mark-templates is idempotent on transformed output', () => {
  assert.ok(tempRoot, 'depends on transform test');
  const second = runCodemod(tempRoot, true);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const output = readFileSync(join(tempRoot, 'sample.html'), 'utf8');
  const expected = readFileSync(afterFixture, 'utf8');
  assert.equal(output, expected);
});

test('mark-templates --check passes on fixtures directory (after file only)', () => {
  const result = runCodemod(fixturesDir, true);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
