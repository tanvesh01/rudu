type ReactDiagnosticsEnv = {
  DEV?: boolean;
  MODE?: string;
  VITE_REACT_SCAN?: string;
  VITE_REACT_SCAN_LOG?: string;
  VITE_REACT_SCAN_UNNECESSARY?: string;
};

export type ReactDiagnosticsMode = {
  enabled: boolean;
  log: boolean;
  trackUnnecessaryRenders: boolean;
};

function envFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getReactDiagnosticsMode(
  env: ReactDiagnosticsEnv,
): ReactDiagnosticsMode {
  const isDevelopment = env.DEV === true || env.MODE === "development";
  const isExplicitlyEnabled = envFlag(env.VITE_REACT_SCAN);

  return {
    enabled: isDevelopment || isExplicitlyEnabled,
    log: envFlag(env.VITE_REACT_SCAN_LOG),
    trackUnnecessaryRenders: envFlag(env.VITE_REACT_SCAN_UNNECESSARY),
  };
}

export async function installReactScanDiagnostics(
  mode: ReactDiagnosticsMode,
): Promise<void> {
  if (!mode.enabled) {
    return;
  }

  const { scan } = await import("react-scan");

  scan({
    enabled: true,
    log: mode.log,
    showToolbar: true,
    showFPS: true,
    showNotificationCount: true,
    trackUnnecessaryRenders: mode.trackUnnecessaryRenders,
  });
}
