import type { Api } from "./apiTypes";
import { RealApi } from "./real";

/**
 * Transport selection. The mock layer is dev-only: it is reached through a
 * dynamic import, so it never enters the production bundle unless explicitly
 * enabled with ?mock=1 (or localStorage concept.mock=1 during development).
 */
export const useMockApi =
  import.meta.env.DEV &&
  (new URLSearchParams(window.location.search).has("mock") ||
    window.localStorage.getItem("concept.mock") === "1");

export const api: Api = useMockApi
  ? await import("./mock/mockApi").then((m) => m.createMockApi())
  : new RealApi();

export * from "./types";
export { ApiError } from "./request";
