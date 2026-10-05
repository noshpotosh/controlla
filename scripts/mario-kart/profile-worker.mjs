/** Add a diagnostic request without changing the core or normal worker policy. */
export function installProfileResetRequest(source) {
  const marker = '    case "rendererDiagnostics":';
  if (source.split(marker).length !== 2)
    throw new Error('CPU profile diagnostic requires the pinned worker dispatch.');
  return source.replace(marker, `    case "controllaResetCpuProfile": {
      if (!api?.setPpcProfileEnabled)
        return { enabled: false, error: "Core does not support CPU profiling." };
      api.setPpcProfileEnabled(0);
      api.setPpcProfileEnabled(1);
      return { enabled: true };
    }
${marker}`);
}
