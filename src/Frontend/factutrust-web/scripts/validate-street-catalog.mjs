/**
 * Non-generating catalogue checks. Schema rules come only from the compiled TS
 * validator. File integrity is not binary safety, rights or release approval.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCatalogContracts } from './street-catalog-contracts.mjs';

const fail = message => { throw new Error(message); };

function parseArguments(args) {
  const values = {};
  const switches = new Set(['--schema-only', '--json']);
  const options = new Set(['--catalog-root', '--version', '--manifest']);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!(switches.has(key) || options.has(key)) || key in values) fail(`cli.arguments: unknown or duplicate option ${key}`);
    if (switches.has(key)) values[key] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) fail(`cli.arguments: ${key} requires a value`);
      values[key] = value;
    }
  }
  if (!values['--manifest']) fail('cli.arguments: --manifest is required (no mutable root default)');
  if (values['--schema-only']) {
    if (values['--version'] || values['--catalog-root']) fail('cli.arguments: schema-only accepts only --manifest and --json');
  } else if (!values['--version'] || !values['--catalog-root']) {
    fail('cli.arguments: file checks require --catalog-root, --version and --manifest; subsets are not supported');
  }
  return values;
}

function readBounded(file, maxBytes, expectedBytes) {
  // A FIFO without a writer would block on open, before the descriptor check.
  if (!lstatSync(file).isFile()) fail('file.type: regular file required');
  // On POSIX, a regular file replaced by a FIFO between lstat/open must not hang.
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) fail('file.type: regular file required');
    if (stat.size > maxBytes) fail(`file.limit-bytes: maximum ${maxBytes}`);
    if (expectedBytes !== undefined && stat.size !== expectedBytes) fail('file.encoded-bytes: encoded byte size mismatch');
    // Read at most the checked size plus one sentinel byte, even if the file grows.
    const bytes = Buffer.allocUnsafe(stat.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(fd, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    if (count !== stat.size || fstatSync(fd).size !== stat.size) fail('file.changed: byte size changed during validation');
    return bytes.subarray(0, count);
  } finally {
    closeSync(fd);
  }
}

function inside(root, file) {
  const rel = relative(root, file);
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** Reject symlinks in the version subtree, then check the actual directory boundary. */
function catalogFile(root, file) {
  if (!inside(root, file)) fail('file.path: path escapes the version directory');
  let current = root;
  for (const segment of relative(root, file).split(sep)) {
    current = resolve(current, segment);
    if (lstatSync(current).isSymbolicLink()) fail('file.symlink: catalogue symlinks are not allowed');
  }
  const actual = realpathSync(file);
  if (!inside(root, actual)) fail('file.realpath: path escapes the version directory');
  return actual;
}

export async function runCatalogCli(args) {
  let compiled;
  const json = args.includes('--json');
  try {
    const options = parseArguments(args);
    compiled = compileCatalogContracts();
    const { contracts } = compiled;
    let manifestFile = resolve(options['--manifest']);
    let versionRoot;
    if (!options['--schema-only']) {
      const version = options['--version'];
      if (!contracts.isValidCatalogVersionToken(version)) fail('cli.version: invalid immutable version');
      const root = realpathSync(resolve(options['--catalog-root']));
      versionRoot = resolve(root, version);
      if (lstatSync(versionRoot).isSymbolicLink() || !lstatSync(versionRoot).isDirectory()) fail('file.version-directory: regular version directory required');
      if (manifestFile !== resolve(versionRoot, 'manifest-v2.json')) fail('file.manifest-path: manifest must be <catalog-root>/<version>/manifest-v2.json');
      manifestFile = catalogFile(versionRoot, manifestFile);
    }
    const manifest = JSON.parse(readBounded(manifestFile, contracts.CATALOG_VALIDATION_LIMITS.jsonBytes).toString('utf8'));
    const violations = contracts.validateBusinessCatalogManifest(manifest);
    if (violations.length) return { exitCode: 1, json, result: { qualification: 'none', violations } };
    if (!options['--schema-only']) {
      if (manifest.catalogVersion !== options['--version']) fail('file.version-mismatch: manifest version does not match its directory');
      if (!manifest.profiles.length || !manifest.scenes.length || !manifest.assets.length) fail('release.empty: an empty schema fixture is not a release');
      for (const asset of manifest.assets) {
        const file = catalogFile(versionRoot, resolve(versionRoot, asset.path));
        const bytes = readBounded(file, 64 * 1024 * 1024, asset.encodedBytes);
        if (asset.sha256 !== createHash('sha256').update(bytes).digest('hex')) fail(`file.sha256: ${asset.assetKey} hash mismatch`);
        if (asset.kind === 'glb') {
          const { validateBytes } = await import('gltf-validator');
          const report = await validateBytes(new Uint8Array(bytes), {
            externalResourceFunction: async () => fail('glb.external-resource: external resource inspection is not supported')
          });
          if (report.issues.numErrors) fail(`file.gltf: ${asset.assetKey} has ${report.issues.numErrors} error(s)`);
        }
      }
    }
    return { exitCode: 0, json, result: {
      qualification: options['--schema-only'] ? 'schema-only' : 'file-integrity-only',
      productionReleaseQualified: false,
      catalogVersion: manifest.catalogVersion,
      profiles: manifest.profiles.length, scenes: manifest.scenes.length, assets: manifest.assets.length,
      violations: []
    } };
  } catch (error) {
    return { exitCode: 1, json, result: { qualification: 'none', error: error.message } };
  } finally {
    compiled?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { exitCode, json, result } = await runCatalogCli(process.argv.slice(2));
  if (json) console.log(JSON.stringify(result));
  else if (exitCode) console.error(result.error ?? result.violations.map(v => `${v.code} ${v.path}: ${v.message}`).join('\n'));
  else console.log(`catalog ${result.catalogVersion}: ${result.profiles} profiles, ${result.scenes} scenes, ${result.assets} assets; ${result.qualification} passed — NOT production release qualification`);
  process.exitCode = exitCode;
}
