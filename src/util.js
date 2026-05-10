import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, "..");

export async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
  return p;
}

export function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export const log = {
  info: (...a) => console.log("[i]", ...a),
  ok:   (...a) => console.log("[✓]", ...a),
  warn: (...a) => console.warn("[!]", ...a),
  err:  (...a) => console.error("[x]", ...a),
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
