import { afterEach, beforeEach, expect, test, vi } from "vitest";

/** Every stream the client opened, so the test can count connections. */
const opened: FakeSource[] = [];

class FakeSource {
  closed = false;
  listeners = new Map<string, (e: { data: string; type: string }) => void>();
  constructor(public url: string) {
    opened.push(this);
  }
  addEventListener(name: string, fn: (e: { data: string; type: string }) => void) {
    this.listeners.set(name, fn);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: unknown) {
    this.listeners.get(name)?.({ data: JSON.stringify(data), type: name });
  }
}

beforeEach(() => {
  opened.length = 0;
  vi.resetModules();
  vi.stubGlobal("EventSource", FakeSource);
});
afterEach(() => vi.unstubAllGlobals());

// Browsers allow six connections per host. One stream per subscriber used them up
// and every later request hung, so pages stayed on a spinner.
test("all subscribers of a workspace share one event stream", async () => {
  const { RealApi } = await import("./real");
  const api = new RealApi();
  const seen: string[] = [];
  const offs = Array.from({ length: 8 }, (_, i) => api.onEvent("crm", (ev) => seen.push(`${i}:${ev.type}`)));
  expect(opened).toHaveLength(1);

  opened[0].emit("change", { type: "change", paths: ["Pages/a.md"] });
  expect(seen).toHaveLength(8);

  offs.slice(1).forEach((off) => off());
  expect(opened[0].closed).toBe(false);
  offs[0]();
  expect(opened[0].closed).toBe(true);

  const off = api.onEvent("crm", () => {});
  expect(opened).toHaveLength(2);
  off();
});
