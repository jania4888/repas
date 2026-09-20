/** Compile the canonical pure TS contracts in temporary storage, never public assets. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const featureRoot = join(webRoot, 'src/app/features/virtual-street');

export function compileCatalogContracts({ tests = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'street-catalog-contracts-'));
  try {
    const files = ['3d/business-scene-contracts.ts', '3d/business-scene-contract-validation.ts'];
    if (tests) files.push('3d/business-scene-contracts.spec.ts', 'testing/business-catalog-validation-corpus.ts');
    const configFile = join(directory, 'tsconfig.json');
    writeFileSync(configFile, JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'CommonJS', moduleResolution: 'Node',
        strict: true, noImplicitReturns: true, noPropertyAccessFromIndexSignature: true,
        esModuleInterop: true, resolveJsonModule: true, noEmitOnError: true,
        types: tests ? ['jasmine'] : [], typeRoots: [join(webRoot, 'node_modules/@types')],
        lib: ['ES2022'], rootDir: featureRoot, outDir: join(directory, 'build')
      },
      files: files.map(file => join(featureRoot, file))
    }));
    const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', configFile], {
      encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Canonical contract compilation failed: ${result.error?.message ?? result.stdout + result.stderr}`);
    }
    const load = relative => require(join(directory, 'build', relative));
    return {
      directory,
      contracts: load('3d/business-scene-contract-validation.js'),
      load,
      close: () => rmSync(directory, { recursive: true, force: true })
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
