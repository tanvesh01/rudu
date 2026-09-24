import type { Terminal } from "ghostty-web";

export function installTerminalWheel(terminal: Terminal) {
  let remainder = 0;
  terminal.attachCustomWheelEventHandler((event) => {
    if (!terminal.hasMouseTracking() || !terminal.getMode(1006)) {
      remainder = 0;
      return false;
    }
    const renderer = terminal.renderer;
    if (!renderer) return false;
    const { width, height } = renderer.getMetrics();
    if (!width || !height) return false;
    const rect = renderer.getCanvas().getBoundingClientRect();
    const col = Math.max(1, Math.min(terminal.cols, Math.floor((event.clientX - rect.left) / width) + 1));
    const row = Math.max(1, Math.min(terminal.rows, Math.floor((event.clientY - rect.top) / height) + 1));
    const delta = event.deltaMode === 0 ? event.deltaY / height : event.deltaMode === 1 ? event.deltaY : event.deltaY * terminal.rows;
    if (delta * remainder < 0) remainder = 0;
    remainder += delta;
    const steps = Math.min(5, Math.trunc(Math.abs(remainder)));
    const button = remainder < 0 ? 64 : 65;
    remainder = Math.sign(remainder) * (Math.abs(remainder) % 1);
    for (let i = 0; i < steps; i++) terminal.input(`\x1b[<${button};${col};${row}M`, true);
    return true;
  });
}
