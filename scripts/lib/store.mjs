/**
 * Local file-based data store for autopilot CLI operations.
 * Mirrors the browser localStorage pattern but uses JSON files on disk.
 * Used by all autopilot modules for persistent state.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = resolve(import.meta.dirname || '.', '..', '..', 'data');

async function ensureDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

export async function load(key, fallback = null) {
  try {
    await ensureDir();
    const raw = await readFile(resolve(DATA_DIR, `${key}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function save(key, value) {
  await ensureDir();
  await writeFile(resolve(DATA_DIR, `${key}.json`), JSON.stringify(value, null, 2), 'utf8');
}

export { DATA_DIR };
