import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { compileCatalogContracts } from './street-catalog-contracts.mjs';

const compiled = compileCatalogContracts({ tests: true });
const { CATALOG_VALIDATION_CASES: corpus } = compiled.load('testing/business-catalog-validation-corpus.js');
const { validManifest } = compiled.load('testing/business-catalog-validation-fixture.js');
const directory = mkdtempSync(join(tmpdir(), 'street-catalog-tests-'));
const script = join(dirname(fileURLToPath(import.meta.url)), 'validate-street-catalog.mjs');
after(() => { compiled.close(); rmSync(directory, { recursive: true, force: true }); });

for (const entry of corpus) {
  test(`Node expected schema corpus: ${entry.name}`, () => {
    // Round-trip through JSON just as the CLI does, not a typed fixture cast.
    const manifest = JSON.parse(JSON.stringify(entry.create()));
    const violations = compiled.contracts.validateBusinessCatalogManifest(manifest);
    assert.deepEqual([...new Set(violations.map(v => v.code))].sort(), [...entry.expectedCodes].sort());
  });
}

function child(args, timeout = 60_000) {
  const result = spawnSync(process.execPath, [script, ...args, '--json'], { encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
  assert.ifError(result.error);
  assert.notEqual(result.status, null, result.stderr);
  return { status: result.status, output: JSON.parse(result.stdout) };
}

for (const name of ['non-empty-synthetic-schema', 'empty-low-level-schema-valid', 'path-double-encoded', 'wrong-editorial-revision', 'missing-attribution', 'fractional-triangles']) {
  test(`real CLI process uses canonical schema: ${name}`, () => {
    const entry = corpus.find(c => c.name === name);
    const manifest = entry.create();
    const file = join(directory, `${name}.json`);
    writeFileSync(file, JSON.stringify(manifest));
    const result = child(['--schema-only', '--manifest', file]);
    assert.equal(result.status, entry.expectedCodes.length ? 1 : 0);
    assert.deepEqual(result.output.violations, compiled.contracts.validateBusinessCatalogManifest(manifest));
    if (!entry.expectedCodes.length) {
      assert.equal(result.output.productionReleaseQualified, false);
      assert.equal(result.output.qualification, 'schema-only');
    }
  });
}

function minimalGlb() {
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Synthetic' }] });
  const padded = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const bytes = Buffer.alloc(20 + padded.length);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(bytes, 20);
  return bytes;
}

let fixtureNumber = 0;
function fileFixture() {
  const root = join(directory, `files-${fixtureNumber++}`);
  const manifest = validManifest();
  const version = manifest.catalogVersion;
  const versionRoot = join(root, version);
  const manifestFile = join(versionRoot, 'manifest-v2.json');
  for (const asset of manifest.assets) {
    // Valid container, deliberately no authored scene: never production-qualified.
    const bytes = asset.kind === 'glb' ? minimalGlb()
      : asset.kind === 'attribution' ? Buffer.from('Synthetic test evidence, not a rights approval.\n')
      : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64');
    asset.encodedBytes = bytes.length;
    asset.sha256 = createHash('sha256').update(bytes).digest('hex');
    const file = join(versionRoot, asset.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const save = () => writeFileSync(manifestFile, JSON.stringify(manifest));
  save();
  return { root, versionRoot, manifest, manifestFile, save,
    args: ['--catalog-root', root, '--version', version, '--manifest', manifestFile] };
}

function hashes(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => {
      const file = join(entry.parentPath ?? entry.path, entry.name);
      return [file, createHash('sha256').update(readFileSync(file)).digest('hex')];
    }).sort();
}

test('file integrity checks every asset without generating or rewriting anything', () => {
  const fixture = fileFixture();
  const before = hashes(fixture.root);
  const result = child(fixture.args);
  assert.equal(result.status, 0, JSON.stringify(result.output));
  assert.equal(result.output.qualification, 'file-integrity-only');
  assert.equal(result.output.productionReleaseQualified, false);
  assert.deepEqual(hashes(fixture.root), before);
});

for (const kind of ['render', 'attribution']) {
  test(`real child fails on a missing ${kind} asset`, () => {
    const fixture = fileFixture();
    const asset = fixture.manifest.assets.find(a => a.kind === kind);
    rmSync(join(fixture.versionRoot, asset.path));
    const result = child(fixture.args);
    assert.equal(result.status, 1);
    assert.match(result.output.error, /ENOENT/);
  });
}

for (const kind of ['manifest', 'schema-only manifest', 'render', 'attribution']) {
  test(`real child rejects a ${kind} FIFO without a writer`, { skip: process.platform === 'win32' }, () => {
    const fixture = fileFixture();
    const file = kind.endsWith('manifest') ? fixture.manifestFile
      : join(fixture.versionRoot, fixture.manifest.assets.find(a => a.kind === kind).path);
    rmSync(file);
    const fifo = spawnSync('mkfifo', [file], { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL' });
    assert.ifError(fifo.error);
    assert.equal(fifo.status, 0, fifo.stderr);
    const args = kind === 'schema-only manifest' ? ['--schema-only', '--manifest', file] : fixture.args;
    // The process must return file.type itself, not be terminated by the timeout.
    const result = child(args, 5000);
    assert.equal(result.status, 1);
    assert.equal(result.output.error, 'file.type: regular file required');
  });
}

test('real child fails on a bad hash without overwriting bytes', () => {
  const fixture = fileFixture();
  fixture.manifest.assets[0].sha256 = '0'.repeat(64);
  fixture.save();
  const before = hashes(fixture.root);
  const result = child(fixture.args);
  assert.equal(result.status, 1);
  assert.match(result.output.error, /file.sha256/);
  assert.deepEqual(hashes(fixture.root), before);
});

test('real child rejects a symlink to a sibling with a common root prefix', () => {
  const fixture = fileFixture();
  const asset = fixture.manifest.assets.find(a => a.kind === 'attribution');
  const file = join(fixture.versionRoot, asset.path);
  const outside = `${fixture.versionRoot}-outside.md`;
  writeFileSync(outside, readFileSync(file));
  rmSync(file);
  symlinkSync(outside, file);
  const result = child(fixture.args);
  assert.equal(result.status, 1);
  assert.match(result.output.error, /file.symlink/);
});

test('empty low-level fixture fails file/release validation', () => {
  const fixture = fileFixture();
  fixture.manifest.assets = [];
  fixture.manifest.scenes = [];
  fixture.manifest.profiles = [];
  fixture.save();
  const result = child(fixture.args);
  assert.equal(result.status, 1);
  assert.match(result.output.error, /release.empty/);
});

test('version mismatch fails before asset checks', () => {
  const fixture = fileFixture();
  fixture.manifest.catalogVersion = 'v2.other';
  fixture.save();
  const result = child(fixture.args);
  assert.equal(result.status, 1);
  assert.match(result.output.error, /file.version-mismatch/);
});

test('oversized JSON is rejected before parsing', () => {
  const file = join(directory, 'oversized.json');
  writeFileSync(file, ' '.repeat(compiled.contracts.CATALOG_VALIDATION_LIMITS.jsonBytes + 1));
  const result = child(['--schema-only', '--manifest', file]);
  assert.equal(result.status, 1);
  assert.match(result.output.error, /file.limit-bytes/);
});

for (const args of [[], ['some-root', 'subset.glb'], ['--manifest', 'x', '--files', 'subset.glb'], ['--manifest', 'x', '--manifest', 'y']]) {
  test(`rejects omitted, positional, subset or duplicate CLI arguments: ${JSON.stringify(args)}`, () => {
    const result = child(args);
    assert.equal(result.status, 1);
    assert.match(result.output.error, /cli.arguments/);
  });
}
