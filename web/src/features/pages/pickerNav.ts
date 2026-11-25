export type PickerAction =
  | { type: "move"; hot: number }
  | { type: "choose"; index: number }
  | { type: "close" }
  | null;

/** What a key does in the slash menu and the `[[` wiki picker. `n` is the number of choices. */
export function pickerAction(key: string, hot: number, n: number, wiki: boolean): PickerAction {
  if (n <= 0) return wiki && key === "Escape" ? { type: "close" } : null;
  if (key === "Escape") return { type: "close" };
  if (key === "ArrowDown") return { type: "move", hot: (hot + 1) % n };
  if (key === "ArrowUp") return { type: "move", hot: (hot + n - 1) % n };
  if (key === "Enter" || (wiki && key === "Tab")) return { type: "choose", index: Math.min(hot, n - 1) };
  return null;
}
