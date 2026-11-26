import type { UpdateStatus } from "@/api";

export const UPDATE_NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PREFS_KEY = "concept.update-notice";

/** Per-browser notice state: the skipped version and when a version was last shown. */
export interface UpdateNoticePrefs {
  skippedVersion?: string;
  shownVersion?: string;
  shownAt?: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function noticeText(status: UpdateStatus | null): string | null {
  if (!status?.available || !status.version) return null;
  return `Concept ${status.version} is available — you have ${status.current}.`;
}

/** Shown at most once per 24 hours per version, never for a skipped version. */
export function shouldShowUpdateNotice(
  status: UpdateStatus | null,
  prefs: UpdateNoticePrefs,
  now = Date.now(),
): boolean {
  if (!noticeText(status)) return false;
  const version = status!.version!;
  if (prefs.skippedVersion === version) return false;
  return !(prefs.shownVersion === version && now - (prefs.shownAt ?? 0) < UPDATE_NOTICE_INTERVAL_MS);
}

export function markShown(prefs: UpdateNoticePrefs, version: string, now = Date.now()): UpdateNoticePrefs {
  return { ...prefs, shownVersion: version, shownAt: now };
}

export function skipVersion(prefs: UpdateNoticePrefs, version: string): UpdateNoticePrefs {
  return { ...prefs, skippedVersion: version };
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readPrefs(store: StorageLike | null = storage()): UpdateNoticePrefs {
  try {
    const parsed = JSON.parse(store?.getItem(PREFS_KEY) ?? "{}") as UpdateNoticePrefs;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Storage can be unavailable (private browsing); the notice still works for the session. */
export function writePrefs(prefs: UpdateNoticePrefs | null, store: StorageLike | null = storage()): void {
  try {
    if (prefs) store?.setItem(PREFS_KEY, JSON.stringify(prefs));
    else store?.removeItem(PREFS_KEY);
  } catch {
    // ignore
  }
}
