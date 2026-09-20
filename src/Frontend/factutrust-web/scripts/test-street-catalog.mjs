/** Run the existing pure Jasmine specs and the Node/CLI suite, without a dev server. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Jasmine from 'jasmine';
import { compileCatalogContracts } from './street-catalog-contracts.mjs';

const compiled = compileCatalogContracts({ tests: true });
try {
  const jasmine = new Jasmine({ projectBaseDir: compiled.directory });
  jasmine.exitOnCompletion = false;
  jasmine.loadConfig({
    spec_dir: 'build',
    spec_files: ['3d/business-scene-contracts.spec.js'],
    random: false
  });
  const result = await jasmine.execute();
  if (result.overallStatus !== 'passed') process.exitCode = 1;
} finally {
  compiled.close();
}
const nodeTests = spawnSync(process.execPath, ['--test', join(dirname(fileURLToPath(import.meta.url)), 'validate-street-catalog.spec.mjs')], {
  stdio: 'inherit', timeout: 180_000
});
if (nodeTests.error) console.error(nodeTests.error.message);
if (nodeTests.error || nodeTests.status !== 0) process.exitCode = 1;
