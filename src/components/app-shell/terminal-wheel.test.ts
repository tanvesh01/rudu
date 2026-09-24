import { expect, test } from "bun:test";
import { Ghostty, Terminal } from "ghostty-web";
import { installTerminalWheel } from "./terminal-wheel";

test("wheel events reach a mouse-tracking TUI as SGR reports", async () => {
  const ghostty = await Ghostty.load(import.meta.resolve("ghostty-web/ghostty-vt.wasm"));
  const terminal = new Terminal({ ghostty });
  terminal.wasmTerm = ghostty.createTerminal(80, 24);
  (terminal as unknown as { isOpen: boolean }).isOpen = true;
  terminal.renderer = {
    getCanvas: () => ({ getBoundingClientRect: () => ({ left: 10, top: 20 }) }),
    getMetrics: () => ({ width: 10, height: 20 }),
  } as unknown as NonNullable<Terminal["renderer"]>;
  const sent: string[] = [];
  terminal.onData((data) => sent.push(data));
  installTerminalWheel(terminal);
  terminal.wasmTerm.write("\x1b[?1049h\x1b[?1000h\x1b[?1006h");

  const wheel = (deltaY: number) =>
    (terminal as unknown as { handleWheel: (event: WheelEvent) => void }).handleWheel({
      deltaY,
      deltaMode: 0,
      clientX: 45,
      clientY: 65,
      preventDefault() {},
      stopPropagation() {},
    } as WheelEvent);

  try {
    wheel(-20);
    wheel(20);
    expect(sent).toEqual(["\x1b[<64;4;3M", "\x1b[<65;4;3M"]);
    wheel(-7);
    wheel(-7);
    wheel(-7);
    expect(sent.slice(2)).toEqual(["\x1b[<64;4;3M"]);

    terminal.wasmTerm.write("\x1b[?1000l\x1b[?1006l");
    sent.length = 0;
    wheel(-33);
    expect(sent).toEqual(["\x1b[A"]);
  } finally {
    terminal.wasmTerm.free();
  }
});
