import { describe, expect, it } from "vitest";
import { pickerAction } from "./pickerNav";

describe("pickerAction", () => {
  it("moves with the arrow keys and wraps", () => {
    expect(pickerAction("ArrowDown", 0, 3, true)).toEqual({ type: "move", hot: 1 });
    expect(pickerAction("ArrowDown", 2, 3, true)).toEqual({ type: "move", hot: 0 });
    expect(pickerAction("ArrowUp", 0, 3, false)).toEqual({ type: "move", hot: 2 });
  });
  it("chooses the highlighted entry with Enter, and with Tab in the wiki picker only", () => {
    expect(pickerAction("Enter", 1, 3, true)).toEqual({ type: "choose", index: 1 });
    expect(pickerAction("Tab", 2, 3, true)).toEqual({ type: "choose", index: 2 });
    expect(pickerAction("Tab", 2, 3, false)).toBeNull();
    expect(pickerAction("Enter", 9, 3, false)).toEqual({ type: "choose", index: 2 });
  });
  it("closes on Escape when visible, lets Escape fall through when the slash menu has no matches, and ignores other keys", () => {
    expect(pickerAction("Escape", 0, 0, true)).toEqual({ type: "close" });
    expect(pickerAction("Escape", 0, 0, false)).toBeNull();
    expect(pickerAction("Escape", 0, 3, false)).toEqual({ type: "close" });
    expect(pickerAction("Enter", 0, 0, true)).toBeNull();
    expect(pickerAction("a", 0, 3, true)).toBeNull();
  });
});
