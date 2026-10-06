/** Add native transport handling and diagnostics to the pinned worker dispatch. */
export function installProfileResetRequest(source) {
  const marker = '    case "rendererDiagnostics":';
  if (source.split(marker).length !== 2)
    throw new Error('CPU profile diagnostic requires the pinned worker dispatch.');
  return source.replace(marker, `    case "controllaStepFrame": {
      if (!moduleInstance?._ControllaStepFrame)
        return { stepped: false, error: "Native frame-step export unavailable." };
      if (api?.getCoreStateName?.() !== "Paused")
        return { stepped: false, error: "Pause the native core before stepping." };
      const before = await handleMessage("controllaNativeProgress", {});
      if (!before.available) return { stepped: false, error: "Native progress unavailable." };
      ppcWasmJitTimingSuspensions += 1;
      resetPpcWasmJitTiming();
      try {
        if (moduleInstance._ControllaStepFrame() !== 1)
          return { stepped: false, error: "Native frame-step request rejected." };
        for (let attempt = 0; attempt < 200; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          api.pumpHostJobs?.();
          const after = await handleMessage("controllaNativeProgress", {});
          if (after.available && after.frame > before.frame && api.getCoreStateName() === "Paused") {
            const frameDelta = after.frame - before.frame;
            return { stepped: true, exactSingleFrame: frameDelta === 1, frameDelta,
              before, after, ...framePayload() };
          }
        }
        return { stepped: false, error: "Native frame-step completion timed out." };
      } finally {
        if (api.getCoreStateName() !== "Paused") api.setCorePaused?.(1);
        ppcWasmJitCorePaused = api.getCoreStateName() === "Paused";
        resetPpcWasmJitTiming();
        ppcWasmJitTimingSuspensions -= 1;
      }
    }
    case "start":
    case "pause": {
      if (!coreBoot.accepted) return framePayload();
      const paused = type === "pause";
      const result = await handleMessage("validationSetCorePaused", { paused });
      const expected = paused ? "Paused" : "Running";
      if (result.coreStateName !== expected)
        throw new Error("Native " + type + " failed: " + (result.error || result.coreStateName || "unknown state"));
      return result;
    }
    case "controllaNativeProgress": {
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
