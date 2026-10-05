const neutral = () => ({ connected: false, mask: 0, stickX: 128, stickY: 128,
  cStickX: 128, cStickY: 128, triggerLeft: 0, triggerRight: 0, analogA: 0, analogB: 0 });
const analog = ['stickX', 'stickY', 'cStickX', 'cStickY', 'triggerLeft', 'triggerRight', 'analogA', 'analogB'];
export function validControllers(value) {
  return Array.isArray(value) && value.length <= 4 && value.every(state => state
    && typeof state.connected === 'boolean' && Number.isInteger(state.mask)
    && state.mask >= 0 && state.mask <= 4095
    && analog.every(field => Number.isInteger(state[field]) && state[field] >= 0 && state[field] <= 255));
}

export async function installEmbeddedGame({ getAdapter, mount, start, sound }) {
  document.body.classList.add('embedded-game');
  document.querySelectorAll('.topbar, .control-panel, .debug-panel, .touch-controls').forEach(element => {
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
  });
  document.querySelector('.play-area').setAttribute('aria-label', 'Double Dash game stage');
  document.querySelector('#screen').setAttribute('aria-label', 'Double Dash game screen');
  const status = document.createElement('p');
  status.className = 'embedded-status'; status.setAttribute('role', 'status');
  status.textContent = 'Getting the race ready…'; document.body.append(status);
  let latest = [], seen = 0, applied = false;
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin
      || event.data?.type !== 'controlla:kart-input' || !validControllers(event.data.controllers)) return;
    latest = event.data.controllers; seen = performance.now();
  });
  // Room snapshots own all four ports. No separate phone pairing or keyboard
  // poller may override the first player's room input in embedded mode.
  setInterval(() => {
    const adapter = getAdapter();
    if (!adapter?.loaded) return;
    const fresh = performance.now() - seen < 500;
    if (!fresh && !applied) return;
    applied = fresh;
    for (let port = 0; port < 4; port++) {
      const state = fresh ? latest[port] ?? neutral() : neutral();
      adapter.setControllerInputState(port, state).catch(error => {
        status.hidden = false; status.textContent = error.message;
      });
    }
  }, 40);
  try {
    if (!crossOriginIsolated) throw new Error('Restart Controlla with npm run dev:mario-kart to prepare this game.');
    const response = await fetch('./local-disc');
    if (!response.ok) throw new Error('The host’s local game image could not be opened.');
    await mount(new File([await response.blob()], 'Double Dash.ciso'));
    if (!getAdapter()?.loaded) throw new Error('Double Dash could not start. End round and try again.');
    start(); status.hidden = true;
    const button = document.createElement('button');
    button.className = 'embedded-sound'; button.textContent = 'Enable sound';
    button.onclick = async () => {
      try { await sound(); button.remove(); }
      catch { button.textContent = 'Tap to enable sound'; }
    };
    document.body.append(button);
  } catch (error) { status.textContent = error.message; }
}
