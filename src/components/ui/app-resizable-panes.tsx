import { useLayoutEffect, type ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";
import { useSidebarSizes } from "../../hooks/use-sidebar-sizes";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./resizable";
import { AppTopBar } from "../app-shell/app-top-bar";

const SIDEBAR_MIN = "15%";
const SIDEBAR_MAX = "40%";
const CENTER_MIN = "30%";

type AppResizablePanesProps = {
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
  leftOpen?: boolean;
  rightOpen?: boolean;
};

function useCollapsedPanel(open: boolean) {
  const panelRef = usePanelRef();

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (open) panel.expand();
    else panel.collapse();
  }, [open, panelRef]);

  return panelRef;
}

function AppResizablePanes({
  left,
  center,
  right,
  leftOpen = true,
  rightOpen = true,
}: AppResizablePanesProps) {
  const hasLeft = left != null;
  const hasRight = right != null;
  const [sizes, setSizes] = useSidebarSizes();
  const leftRef = useCollapsedPanel(leftOpen);
  const rightRef = useCollapsedPanel(rightOpen);

  return (
    <ResizablePanelGroup
      className="h-full min-h-0 min-w-0"
      id="rudu-panes"
      onLayoutChanged={(_layout, meta) => {
        if (!meta.isUserInteraction) return;
        const leftSize = leftRef.current?.getSize().inPixels;
        const rightSize = rightRef.current?.getSize().inPixels;
        setSizes({
          left: leftSize && leftSize > 0 ? leftSize : undefined,
          right: rightSize && rightSize > 0 ? rightSize : undefined,
        });
      }}
      orientation="horizontal"
    >
      {hasLeft ? (
        <ResizablePanel
          className="min-h-0 bg-surface"
          collapsedSize={0}
          collapsible
          defaultSize={sizes.left}
          groupResizeBehavior="preserve-pixel-size"
          id="left"
          maxSize={SIDEBAR_MAX}
          minSize={SIDEBAR_MIN}
          panelRef={leftRef}
        >
          {left}
        </ResizablePanel>
      ) : null}
      {hasLeft ? <ResizableHandle disabled={!leftOpen} /> : null}
      <ResizablePanel className="min-h-0 min-w-0" id="center" minSize={CENTER_MIN}>
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <AppTopBar />
          <div className="min-h-0 min-w-0 flex-1">{center}</div>
        </div>
      </ResizablePanel>
      {hasRight ? <ResizableHandle disabled={!rightOpen} /> : null}
      {hasRight ? (
        <ResizablePanel
          className="min-h-0 bg-surface"
          collapsedSize={0}
          collapsible
          defaultSize={sizes.right}
          groupResizeBehavior="preserve-pixel-size"
          id="right"
          maxSize={SIDEBAR_MAX}
          minSize={SIDEBAR_MIN}
          panelRef={rightRef}
        >
          {right}
        </ResizablePanel>
      ) : null}
    </ResizablePanelGroup>
  );
}

export { AppResizablePanes };
