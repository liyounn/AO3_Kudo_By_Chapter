#!/usr/bin/env node
/**
 * Packages the browser extension into dist/extension.zip.
 * Run: node scripts/build.js  (or: npm run build:extension)
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join } from 'path';

const ROOT   = new URL('..', import.meta.url).pathname;
const DIST   = join(ROOT, 'dist');
const STAGE  = join(DIST, 'extension');
const ZIP    = join(DIST, 'extension.zip');

const EXTENSION_FILES = [
  'manifest.json',
  'content.js',
  'content.css',
  'kudos-core.js',
  'storage-adapters.js',
  'popup.html',
  'icons',
];

// Clean staging area
if (existsSync(STAGE)) rmSync(STAGE, { recursive: true });
mkdirSync(STAGE, { recursive: true });

// Copy extension files into staging area
for (const file of EXTENSION_FILES) {
  const src = join(ROOT, file);
  if (!existsSync(src)) {
    console.error(`Missing: ${file} — run scripts/make-icons.py first if icons are absent`);
    process.exit(1);
  }
  cpSync(src, join(STAGE, file), { recursive: true });
}

// Zip the staging area
if (existsSync(ZIP)) rmSync(ZIP);
execSync(`cd "${STAGE}" && zip -r "${ZIP}" .`, { stdio: 'inherit' });

console.log(`\nExtension packaged → ${ZIP}`);
