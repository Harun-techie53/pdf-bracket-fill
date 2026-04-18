import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Placeholder } from './types.js';

const STORE_PATH = process.env.STORE_PATH ?? path.resolve(process.cwd(), 'placeholders.json');
const PDF_DIR = process.env.PDF_DIR ?? path.resolve(process.cwd(), 'storage');

type Store = Record<string, Placeholder[]>;

function ensurePdfDir(): void {
  if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
}

function pdfPath(uuid: string): string {
  return path.join(PDF_DIR, `${uuid}.pdf`);
}

function loadStore(): Store {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as Store;
  } catch {
    return {};
  }
}

const store: Store = loadStore();

function persist(): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function saveSession(uuid: string, placeholders: Placeholder[]): void {
  store[uuid] = placeholders;
  persist();
}

export function loadSession(uuid: string): Placeholder[] | null {
  return store[uuid] ?? null;
}

export function deleteSession(uuid: string): void {
  if (uuid in store) {
    delete store[uuid];
    persist();
  }
}

export function savePdfBytes(uuid: string, bytes: Uint8Array): void {
  ensurePdfDir();
  fs.writeFileSync(pdfPath(uuid), Buffer.from(bytes));
}

export function loadPdfBytes(uuid: string): Uint8Array | null {
  const p = pdfPath(uuid);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p);
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  return copy;
}

export function deletePdfBytes(uuid: string): void {
  const p = pdfPath(uuid);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
