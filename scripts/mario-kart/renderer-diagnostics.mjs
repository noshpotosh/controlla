/** Read worker-side GPU errors without exposing emulator controls to players. */
export function installRendererDiagnostics({ getAdapter, getFrame, setProbeInput }) {
  if (new URLSearchParams(location.search).get('rendererdiagnostics') !== '1') return;
  const report = document.createElement('pre');
  report.id = 'controlla-renderer-diagnostics';
  report.hidden = true;
  document.body.append(report);
  let pending = false;
  const timer = setInterval(async () => {
    const adapter = getAdapter();
    if (pending || !adapter?.loaded || typeof adapter.request !== 'function') return;
    pending = true;
    try {
      const renderer = await adapter.request('rendererDiagnostics');
      report.textContent = JSON.stringify({ capturedAt: new Date().toISOString(), frame: getFrame(), renderer });
    } catch (error) {
      report.textContent = JSON.stringify({ error: error.message });
    } finally { pending = false; }
  }, 2000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  if (new URLSearchParams(location.search).get('probeinputs') !== '1') return;
  const controls = document.createElement('details');
  controls.innerHTML = '<summary>Input probe</summary>';
  document.querySelector('.topbar-actions').append(controls);
  let held = null, targetFrame = 0;
  for (const [name, mask] of [['Start', 16], ['Confirm', 1], ['Back', 2], ['Up', 256], ['Down', 512], ['Left', 1024], ['Right', 2048]]) {
    const button = document.createElement('button');
    button.textContent = `${name} (30 frames)`;
    button.onclick = () => {
      if (!getAdapter()?.loaded) return;
      targetFrame = (getFrame()?.frame ?? 0) + 30;
      held = { connected: true, mask, stickX: 128, stickY: 128, cStickX: 128, cStickY: 128,
        triggerLeft: 0, triggerRight: 0, analogA: mask === 1 ? 255 : 0, analogB: mask === 2 ? 255 : 0 };
      setProbeInput(held);
    };
    controls.append(button);
  }
  const inputTimer = setInterval(() => {
    if (!held) return;
    if ((getFrame()?.frame ?? 0) >= targetFrame) {
      held = null; setProbeInput(null);
    } else setProbeInput(held);
  }, 40);
  window.addEventListener('pagehide', () => clearInterval(inputTimer), { once: true });
}
