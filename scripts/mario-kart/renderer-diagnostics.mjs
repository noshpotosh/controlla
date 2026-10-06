/** Read worker-side GPU errors without exposing emulator controls to players. */
export function installRendererDiagnostics({ getAdapter, getFrame, setProbeInput, refreshPresentation }) {
  if (new URLSearchParams(location.search).get('rendererdiagnostics') !== '1') return;
  const report = document.createElement('pre');
  report.id = 'controlla-renderer-diagnostics';
  report.hidden = true;
  document.body.append(report);
  const exitFullscreen = document.createElement('button');
  exitFullscreen.type = 'button';
  exitFullscreen.textContent = 'Exit fullscreen';
  exitFullscreen.className = 'controlla-diagnostic-exit';
  exitFullscreen.addEventListener('click', () => document.exitFullscreen());
  document.querySelector('.crt-set').append(exitFullscreen);
  let probe = null;
  let pending = false;
  let frameStep = null;
  let observeNativeFrame = () => {};
  const nativeProgressRequested = new URLSearchParams(location.search).get('pauseprobe') === '1';
  const timer = setInterval(async () => {
    const adapter = getAdapter();
    if (pending || !adapter?.loaded || typeof adapter.request !== 'function') return;
    pending = true;
    try {
      const renderer = await adapter.request('rendererDiagnostics');
      const nativeProgress = nativeProgressRequested ? await adapter.request('controllaNativeProgress') : undefined;
      report.textContent = JSON.stringify({ capturedAt: new Date().toISOString(), frame: getFrame(), renderer, probe, nativeProgress, frameStep });
    } catch (error) {
      report.textContent = JSON.stringify({ error: error.message });
    } finally { pending = false; }
  }, 2000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  if (new URLSearchParams(location.search).get('framestep') === '1') {
    const step = document.createElement('button');
    step.textContent = 'Step native frame';
    step.type = 'button';
    document.querySelector('.topbar-actions').append(step);
    step.addEventListener('click', async () => {
      step.disabled = true;
      try {
        const adapter = getAdapter();
        const result = await adapter?.request('controllaStepFrame');
        frameStep = result ? { stepped: result.stepped, exactSingleFrame: result.exactSingleFrame,
          frameDelta: result.frameDelta, before: result.before, after: result.after, error: result.error } : null;
        if (!result?.stepped) throw new Error(result?.error || 'Load and pause the game before stepping.');
        adapter.applyFrame?.(result);
        refreshPresentation?.();
        observeNativeFrame(result.after);
        step.textContent = result.exactSingleFrame ? 'Stepped one native frame' : `Advanced ${result.frameDelta} native frames`;
      } catch (error) { step.textContent = error.message; }
      finally { step.disabled = false; }
    });
  }
  if (new URLSearchParams(location.search).get('ppcprof') === '1') {
    const reset = document.createElement('button');
    reset.textContent = 'Reset CPU profile';
    reset.type = 'button';
    document.querySelector('.topbar-actions').append(reset);
    reset.addEventListener('click', async () => {
      reset.disabled = true;
      try {
        const result = await getAdapter()?.request('controllaResetCpuProfile');
        if (!result?.enabled) throw new Error(result?.error || 'Load the game before resetting its CPU profile.');
        reset.textContent = 'CPU profile restarted';
      } catch (error) { reset.textContent = error.message; }
      finally { reset.disabled = false; }
    });
  }
  if (new URLSearchParams(location.search).get('probeinputs') !== '1') return;
  const controls = document.createElement('details');
  controls.innerHTML = '<summary>Input probe</summary>';
  document.querySelector('.topbar-actions').append(controls);
  let held = null, targetFrame = 0, inputGeneration = 0;
  const nativeProbe = new URLSearchParams(location.search).get('nativeprobe') === '1';
  const beginProbe = (name, mask, frames, stickX, startFrame, basis) => {
    targetFrame = startFrame + frames;
    held = { connected: true, mask, stickX, stickY: 128, cStickX: 128, cStickY: 128,
      triggerLeft: 0, triggerRight: mask & 64 ? 255 : 0, analogA: mask & 1 ? 255 : 0, analogB: mask & 2 ? 255 : 0 };
    probe = { name, requested: { ...held }, basis, startFrame, targetFrame, observations: [], releasedAtFrame: null };
    setProbeInput(held);
  };
  const probes = [
    ['Start', 16], ['Confirm', 1], ['Back', 2], ['Up', 256], ['Down', 512], ['Left', 1024], ['Right', 2048],
    ['Accelerate', 1, 300], ['Steer left + gas', 1, 90, 64], ['Steer right + gas', 1, 90, 192],
    ['Brake', 2, 90], ['Item', 4], ['Swap riders', 128],
    ['Drift left + gas', 65, 300, 64], ['Drift right + gas', 65, 300, 192],
  ];
  for (const [name, mask, frames = 30, stickX = 128] of probes) {
    const button = document.createElement('button');
    button.textContent = `${name} (${frames} frames)`;
    button.onclick = () => {
      if (!getAdapter()?.loaded) return;
      if (!nativeProbe) return beginProbe(name, mask, frames, stickX, getFrame()?.frame ?? 0, 'host');
      const generation = ++inputGeneration;
      held = null; setProbeInput(null);
      button.disabled = true;
      return (async () => {
        try {
          if (getFrame()?.running !== false || new URLSearchParams(location.search).get('framestep') !== '1')
            throw new Error('Native input probes require a paused frame-step session.');
          const progress = await getAdapter().request('controllaNativeProgress');
          if (generation !== inputGeneration) return;
          if (getFrame()?.running !== false) throw new Error('Game resumed during native probe setup.');
          if (!progress?.available || !Number.isSafeInteger(progress.frame))
            throw new Error('Native frame counter unavailable.');
          beginProbe(name, mask, frames, stickX, progress.frame, 'native');
        } catch (error) {
          if (generation === inputGeneration) probe = { name, basis: 'native', error: error.message };
        } finally { button.disabled = false; }
      })();
    };
    controls.append(button);
  }
  // Observe each published frame as well as the heartbeat. Native workers can
  // still advance between reports, so this reduces latency, not an exact bound.
  const observeFrame = (frame = getFrame()) => {
    if (!held) return;
    if (probe.basis === 'native' && frame?.running === true) {
      probe.error = 'Native input trial cancelled: game resumed.';
      held = null; setProbeInput(null);
      return;
    }
    const pad = frame?.ppcWasmHelperStats?.match(/pad polls:.*? fastsw:[01]/)?.[0];
    if (pad && probe.observations.at(-1)?.pad !== pad) {
      probe.observations.push({ frame: frame.frame, pad });
      if (probe.observations.length > 64) probe.observations.shift();
    }
    if (probe.basis !== 'native' && (frame?.frame ?? 0) >= targetFrame) {
      probe.releasedAtFrame = frame?.frame ?? 0;
      held = null; setProbeInput(null);
    } else setProbeInput(held);
  };
  observeNativeFrame = progress => {
    if (!held || probe.basis !== 'native' || !progress?.available) return;
    probe.lastNativeFrame = progress.frame;
    if (progress.frame >= targetFrame) {
      probe.releasedAtFrame = progress.frame;
      held = null; setProbeInput(null);
    }
  };
  const inputTimer = setInterval(() => observeFrame(), 40);
  window.addEventListener('pagehide', () => { clearInterval(inputTimer); ++inputGeneration; held = null; setProbeInput(null); }, { once: true });
  return { observeFrame };
}
