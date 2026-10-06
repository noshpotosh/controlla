/** Add a diagnostic request without changing the core or normal worker policy. */
export function installProfileResetRequest(source) {
  const marker = '    case "rendererDiagnostics":';
  if (source.split(marker).length !== 2)
    throw new Error('CPU profile diagnostic requires the pinned worker dispatch.');
  return source.replace(marker, `    case "controllaNativeProgress": {
      if (!api?.getCoreTicksLow || !api?.getCoreTicksHigh || !api?.getFrame)
        return { available: false };
      for (let attempt = 0; attempt < 3; attempt++) {
        const high = api.getCoreTicksHigh() >>> 0;
        const low = api.getCoreTicksLow() >>> 0;
        if (high !== (api.getCoreTicksHigh() >>> 0)) continue;
        return { available: true, capturedAtMs: performance.now(),
          frame: api.getFrame() >>> 0, ticks: high * 0x100000000 + low };
      }
      return { available: false, error: "Native tick counter changed during sampling." };
    }
    case "controllaResetCpuProfile": {
      if (!api?.setPpcProfileEnabled)
        return { enabled: false, error: "Core does not support CPU profiling." };
      api.setPpcProfileEnabled(0);
      api.setPpcProfileEnabled(1);
      return { enabled: true };
    }
${marker}`);
}
