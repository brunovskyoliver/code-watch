import crypto from "node:crypto";

export function now(): number {
  return Date.now();
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function hashLine(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

export function parseCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }

  const value = Number.parseInt(cursor, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
