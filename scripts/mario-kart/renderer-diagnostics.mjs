/** Read worker-side GPU errors without exposing emulator controls to players. */
export function installRendererDiagnostics({ getAdapter, getFrame, setProbeInput }) {
  if (new URLSearchParams(location.search).get('rendererdiagnostics') !== '1') return;
  const report = document.createElement('pre');
  report.id = 'controlla-renderer-diagnostics';
  report.hidden = true;
  document.body.append(report);
  let probe = null;
  let pending = false;
  const timer = setInterval(async () => {
    const adapter = getAdapter();
    if (pending || !adapter?.loaded || typeof adapter.request !== 'function') return;
    pending = true;
    try {
      const renderer = await adapter.request('rendererDiagnostics');
      report.textContent = JSON.stringify({ capturedAt: new Date().toISOString(), frame: getFrame(), renderer, probe });
    } catch (error) {
      report.textContent = JSON.stringify({ error: error.message });
    } finally { pending = false; }
  }, 2000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
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
  let held = null, targetFrame = 0;
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
      targetFrame = (getFrame()?.frame ?? 0) + frames;
      held = { connected: true, mask, stickX, stickY: 128, cStickX: 128, cStickY: 128,
        triggerLeft: 0, triggerRight: mask & 64 ? 255 : 0, analogA: mask & 1 ? 255 : 0, analogB: mask & 2 ? 255 : 0 };
      probe = { name, requested: { ...held }, targetFrame, observations: [], releasedAtFrame: null };
      setProbeInput(held);
    };
    controls.append(button);
  }
  const inputTimer = setInterval(() => {
    if (!held) return;
    const frame = getFrame();
    const pad = frame?.ppcWasmHelperStats?.match(/pad polls:.*? fastsw:[01]/)?.[0];
    if (pad && probe.observations.at(-1)?.pad !== pad) {
      probe.observations.push({ frame: frame.frame, pad });
      if (probe.observations.length > 64) probe.observations.shift();
    }
    if ((frame?.frame ?? 0) >= targetFrame) {
      probe.releasedAtFrame = frame?.frame ?? 0;
      held = null; setProbeInput(null);
    } else setProbeInput(held);
  }, 40);
  window.addEventListener('pagehide', () => clearInterval(inputTimer), { once: true });
}
