import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FitAddon, Terminal } from "ghostty-web";
import { getErrorMessage } from "../../lib/get-error-message";
import { installTerminalWheel } from "./terminal-wheel";

type TerminalEvent = { checkoutId: string; sessionId: number };
type TerminalOutput = TerminalEvent & { data: number[] };

function GhosttyTerminalPanel({
  checkoutId,
  host,
  visible,
}: {
  checkoutId: string;
  host: HTMLElement;
  visible: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const restartRef = useRef<(() => Promise<void>) | null>(null);
  const visibleRef = useRef(visible);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    visibleRef.current = visible;
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  useEffect(() => {
    let disposed = false;
    let terminal: Terminal | undefined;
    let fit: FitAddon | undefined;
    const unlisten: (() => void)[] = [];
    let stopInput: (() => void) | undefined;
    let stopResize: (() => void) | undefined;
    let activeId: number | null = null;
    let endedNow = false;
    let starting = false;
    let pending: (() => void)[] = [];

    // Buffer events before start_terminal returns, then discard any from an older PTY.
    const deliver = (sessionId: number, action: () => void) => {
      if (activeId === null) pending.push(() => deliver(sessionId, action));
      else if (activeId === sessionId) action();
    };

    async function start() {
      const [{ FitAddon, Ghostty, Terminal }, { default: wasmUrl }] = await Promise.all([
        import("ghostty-web"),
        import("ghostty-web/ghostty-vt.wasm?url"),
      ]);
      const ghostty = await Ghostty.load(wasmUrl);
      if (disposed || !container.current) return;
      const view = new Terminal({
        ghostty,
        fontFamily: "Geist Mono, Menlo, monospace",
        fontSize: 13,
        theme: { background: "#10161f", foreground: "#dce5ef" },
      });
      terminal = view;
      view.open(container.current);
      terminalRef.current = view;
      installTerminalWheel(view);
      fit = new FitAddon();
      fitRef.current = fit;
      view.loadAddon(fit);
      fit.fit();
      const stopOutput = await listen<TerminalOutput>("rudu://terminal-output", ({ payload }) => {
        if (!disposed && payload.checkoutId === checkoutId) {
          deliver(payload.sessionId, () => view.write(new Uint8Array(payload.data)));
        }
      });
      if (disposed) { stopOutput(); return; }
      unlisten.push(stopOutput);
      const stopExit = await listen<TerminalEvent>("rudu://terminal-exit", ({ payload }) => {
        if (!disposed && payload.checkoutId === checkoutId) {
          deliver(payload.sessionId, () => { endedNow = true; setEnded(true); });
        }
      });
      if (disposed) { stopExit(); return; }
      unlisten.push(stopExit);

      const startSession = async (restart: boolean) => {
        if (starting) return;
        starting = true;
        setBusy(true);
        setError("");
        activeId = null;
        pending = [];
        try {
          if (restart) await invoke("stop_terminal", { checkoutId });
          const sessionId = await invoke<number>("start_terminal", { checkoutId, cols: view.cols, rows: view.rows });
          if (disposed) return;
          if (restart) view.reset();
          activeId = sessionId;
          endedNow = false;
          setEnded(false);
          const buffered = pending;
          pending = [];
          buffered.forEach((flush) => flush());
          if (!stopInput) stopInput = view.onData((data) => {
            if (!endedNow) void invoke("write_terminal", { checkoutId, data }).catch((cause) => setError(getErrorMessage(cause)));
          }).dispose;
          if (!stopResize) stopResize = view.onResize(({ cols, rows }) => {
            if (!endedNow) void invoke("resize_terminal", { checkoutId, cols, rows }).catch((cause) => setError(getErrorMessage(cause)));
          }).dispose;
          fit?.observeResize();
          if (visibleRef.current) view.focus();
        } catch (cause) {
          pending = [];
          if (!disposed) setError(getErrorMessage(cause));
        } finally {
          starting = false;
          if (!disposed) setBusy(false);
        }
      };
      restartRef.current = () => startSession(true);
      await startSession(false);
    }

    void start().catch((cause) => {
      if (!disposed) setError(getErrorMessage(cause));
    });

    return () => {
      disposed = true;
      restartRef.current = null;
      stopInput?.();
      stopResize?.();
      unlisten.forEach((stop) => stop());
      fit?.dispose();
      terminal?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [checkoutId]);

  return createPortal(
    <section
      aria-label="Checkout terminal"
      className="flex h-full min-h-0 flex-col bg-[#10161f]"
      style={visible ? undefined : { display: "none" }}
    >
      {/* ponytail: Ghostty Web 0.4.0 reserves 15px for its in-canvas scrollbar; remove this offset if upstream changes. */}
      <div ref={container} className="-mr-[15px] min-h-0 flex-1 p-2" />
      {ended && <div className="flex items-center justify-between bg-surface px-3 py-1 text-xs text-ink-500">
        <span>Shell exited</span>
        <button className="text-brand-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => void restartRef.current?.()} type="button">Restart</button>
      </div>}
      {error && <div role="alert" className="flex items-center justify-between bg-surface px-3 py-1 text-xs text-danger-600">
        <span>{error}</span>
        {!ended && restartRef.current && <button disabled={busy} onClick={() => void restartRef.current?.()} type="button">Retry</button>}
      </div>}
    </section>,
    host,
  );
}

export { GhosttyTerminalPanel };
