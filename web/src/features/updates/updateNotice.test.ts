import { describe, expect, it } from "vitest";
import type { UpdateStatus } from "@/api";
import {
  markShown,
  noticeText,
  readPrefs,
  shouldShowUpdateNotice,
  skipVersion,
  UPDATE_NOTICE_INTERVAL_MS,
  writePrefs,
} from "./updateNotice";

const NOW = 1_800_000_000_000;

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    enabled: true,
    checkedAt: "2026-11-26T00:00:00.000Z",
    current: "0.2.0",
    available: true,
    version: "0.3.0",
    releaseUrl: "https://example.test/releases/tag/v0.3.0",
    notes: "New board views",
    command: "git pull && docker compose up -d --build",
    error: null,
    ...overrides,
  };
}

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("admin update notice", () => {
  it("names the new and the current version", () => {
    expect(noticeText(status())).toBe("Concept 0.3.0 is available — you have 0.2.0.");
  });

  it("stays hidden without a newer release or when checks are off", () => {
    expect(noticeText(status({ available: false, version: null }))).toBeNull();
    expect(shouldShowUpdateNotice(status({ available: false, version: null }), {}, NOW)).toBe(false);
    expect(shouldShowUpdateNotice(null, {}, NOW)).toBe(false);
  });

  it("skips a version until a newer one is released", () => {
    const prefs = skipVersion({}, "0.3.0");
    expect(shouldShowUpdateNotice(status(), prefs, NOW)).toBe(false);
    expect(shouldShowUpdateNotice(status({ version: "0.3.1" }), prefs, NOW)).toBe(true);
  });

  it("shows a version at most once per 24 hours", () => {
    const prefs = markShown({}, "0.3.0", NOW);
    expect(shouldShowUpdateNotice(status(), prefs, NOW + 60_000)).toBe(false);
    expect(shouldShowUpdateNotice(status(), prefs, NOW + UPDATE_NOTICE_INTERVAL_MS)).toBe(true);
    expect(shouldShowUpdateNotice(status({ version: "0.4.0" }), prefs, NOW + 60_000)).toBe(true);
  });

  it("keeps one small storage entry and removes it on opt-out", () => {
    const store = memoryStore();
    writePrefs(markShown(skipVersion({}, "0.3.0"), "0.3.0", NOW), store);
    expect([...store.data.keys()]).toEqual(["concept.update-notice"]);
    expect(readPrefs(store)).toEqual({ skippedVersion: "0.3.0", shownVersion: "0.3.0", shownAt: NOW });
    writePrefs(null, store);
    expect(store.data.size).toBe(0);
    expect(readPrefs(store)).toEqual({});
    expect(readPrefs({ ...store, getItem: () => "not json" })).toEqual({});
  });
});
