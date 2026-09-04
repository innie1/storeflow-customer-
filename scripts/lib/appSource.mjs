import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** One file, with line endings normalised so assertions are not OS-dependent. */
export function readFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every .ts/.tsx file under src/, concatenated.
 *
 * These regression checks assert on source text. They used to read src/App.tsx
 * directly, which meant they were really asserting "this logic lives in this
 * one file" — so moving a function into a module of its own broke a test that
 * was supposed to be about behaviour. Reading the whole of src/ keeps every
 * assertion honest (delete the logic and the test still fails) without pinning
 * the file layout in place.
 *
 * Each file is preceded by a `// ==== <path>` marker so a failure can be traced
 * back to a file with a grep.
 */
export function readAppSource() {
  return walk(path.join(root, 'src'))
    .sort()
    .map(file => `// ==== ${path.relative(root, file).replace(/\\/g, '/')}\n` + fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    .join('\n');
}
