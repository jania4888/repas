#!/usr/bin/env node
/**
 * Phase 9 static gate: translations, no label logic, ERP copy/CSS guards.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const steps = [
  ['i18n:check', ['run', 'i18n:check']],
  ['i18n:no-label-logic', ['run', 'i18n:no-label-logic']],
  ['test:erp-i18n', ['run', 'test:erp-i18n']]
];

for (const [label, npmArgs] of steps) {
  console.log(`[verify-phase9] ${label}`);
  const result = spawnSync('npm', npmArgs, {
    cwd: WEB,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    console.error(`[verify-phase9] failed at ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[verify-phase9] OK');
