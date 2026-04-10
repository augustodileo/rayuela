#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', 'src', 'index.ts');
const args = process.argv.slice(2).join(' ');

try {
  execSync(`npx tsx "${src}" ${args}`, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
} catch (e) {
  process.exit(e.status || 1);
}
