import { randomBytes, randomUUID } from "node:crypto";

export function shortId(prefix: string, bytes = 8): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

export function newId(): string {
  return randomUUID();
}

export function now(): number {
  return Date.now();
}
