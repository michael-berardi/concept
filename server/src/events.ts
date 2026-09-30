import { EventEmitter } from "node:events";

export type ChangeEvent =
  | { type: "change"; paths: string[]; actor: string }
  | { type: "comment"; path: string; actor: string }
  | { type: "sync"; status: string; detail?: string };

/** Per-workspace pub/sub used by the SSE endpoint. */
export class EventBus {
  private emitters = new Map<string, EventEmitter>();

  private emitter(wsSlug: string): EventEmitter {
    let e = this.emitters.get(wsSlug);
    if (!e) {
      e = new EventEmitter();
      e.setMaxListeners(100);
      this.emitters.set(wsSlug, e);
    }
    return e;
  }

  publish(wsSlug: string, event: ChangeEvent): void {
    this.emitter(wsSlug).emit("event", event);
  }

  subscribe(wsSlug: string, fn: (e: ChangeEvent) => void): () => void {
    const e = this.emitter(wsSlug);
    e.on("event", fn);
    return () => e.off("event", fn);
  }
}
