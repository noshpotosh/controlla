import { MotionSteering } from './motion-steering.mjs';
const steering = new MotionSteering();
const params = new URLSearchParams(location.search);
const token = params.get('token');
const port = Number(params.get('port') || 0);
if (!Number.isInteger(port) || port < 0 || port > 3) throw new Error('Invalid controller port.');
document.querySelector('h1').textContent = `Double Dash · Player ${port + 1}`;
const client = [...crypto.getRandomValues(new Uint8Array(18))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const status = document.querySelector('#status');
const connection = document.querySelector('#connection');
const buttons = new Map();
let tilt = NaN, sampleAt = 0, enabled = false, sequence = 0, busy = false;
document.querySelector('#enable').onclick = async () => {
  try {
    if (!isSecureContext) throw new Error('Motion needs a trusted HTTPS phone link. Touch steering is available.');
    if (typeof DeviceMotionEvent === 'undefined') throw new Error('Motion sensors unavailable. Use touch steering.');
    if (DeviceMotionEvent.requestPermission && await DeviceMotionEvent.requestPermission() !== 'granted') throw new Error('Motion permission denied.');
    enabled = true;
    status.textContent = 'Motion enabled. Hold a comfortable angle and tap Recenter.';
  } catch (error) { status.textContent = error.message; }
};
window.addEventListener('devicemotion', event => {
  if (!enabled) return;
  const acceleration = event.accelerationIncludingGravity;
  if (!Number.isFinite(acceleration?.x) || !Number.isFinite(acceleration?.y)) return;
  const angle = (screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI / 180;
  tilt = Math.max(-1, Math.min(1, (acceleration.x * Math.cos(angle) - acceleration.y * Math.sin(angle)) / 6));
  sampleAt = performance.now();
});
document.querySelector('#center').onclick = () => {
  if (!Number.isFinite(tilt) || performance.now() - sampleAt > 250) { status.textContent = 'Enable motion and wait for a sensor reading first.'; return; }
  steering.recenter(tilt);
  status.textContent = 'Steering centered.';
};
document.querySelector('#sensitivity').oninput = event => { steering.sensitivity = Number(event.target.value); };
for (const button of document.querySelectorAll('[data-mask]')) {
  button.onpointerdown = event => { button.setPointerCapture(event.pointerId); buttons.set(event.pointerId, Number(button.dataset.mask)); };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = event => buttons.delete(event.pointerId);
}
const fallback = document.querySelector('#fallback');
fallback.onpointerup = fallback.onpointercancel = () => { fallback.value = '128'; };
function snapshot(connected) {
  const mask = connected ? [...buttons.values()].reduce((a, b) => a | b, 0) : 0;
  return { connected, mask, stickX: connected ? (enabled ? steering.sample(tilt, 40, { sampleAgeMs: performance.now() - sampleAt }) : Number(fallback.value)) : 128,
    stickY: 128, cStickX: 128, cStickY: 128, triggerLeft: mask & 32 ? 255 : 0, triggerRight: mask & 64 ? 255 : 0, analogA: mask & 1 ? 255 : 0, analogB: mask & 2 ? 255 : 0 };
}
async function send(connected = true) {
  if (busy || !token) return;
  busy = true;
  try {
    const response = await fetch('/phone-input?port=' + port + '&token=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client, sequence: ++sequence, state: snapshot(connected) }), signal: AbortSignal.timeout(200) });
    if (!response.ok) throw new Error(await response.text());
    connection.textContent = connected ? 'Controller linked' : 'Controller released';
  } catch (error) { connection.textContent = 'Controller connection: ' + error.message; }
  finally { busy = false; }
}
function release() { buttons.clear(); steering.reset(); fallback.value = '128'; void send(false); }
window.addEventListener('blur', release);
document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
setInterval(() => { if (!document.hidden) void send(); }, 40);
