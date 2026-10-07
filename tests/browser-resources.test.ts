import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserResources } from '../src/client/runtime/browser/browser-resources.ts';
import { isSound, playSound } from '../src/client/runtime/browser/sounds.ts';
import { sounds as harvestSounds } from '../src/client/minigames/neon-harvest/sounds.ts';
import { sounds as whackSounds } from '../src/client/minigames/whack-a-mole/sounds.ts';
import type { BrowserEnvironment } from '../src/client/runtime/browser/contracts.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const document = new EventTarget(),
    window = new EventTarget();
  const lifecycle: [boolean, boolean][] = [],
    held: boolean[] = [];
  const callbacks: EventListener[] = [];
  let hidden = false,
    listeners = 0,
    closes = 0,
    requests = 0,
    releases = 0;
  const audio = deferred<void>(),
    wake = deferred<WakeLockSentinel>();
  const sentinel = Object.assign(new EventTarget(), {
    release: async () => {
      releases++;
      sentinel.dispatchEvent(new Event('release'));
    },
  }) as unknown as WakeLockSentinel;
  const environment: BrowserEnvironment = {
    hidden: () => hidden,
    listen: (target, event, callback) => {
      const surface = target === 'window' ? window : document;
      callbacks.push(callback);
      listeners++;
      surface.addEventListener(event, callback);
      return () => {
        listeners--;
        surface.removeEventListener(event, callback);
      };
    },
    createAudio: () =>
      ({
        state: 'running',
        resume: () => audio.promise,
        close: async () => {
          closes++;
        },
      }) as unknown as AudioContext,
    requestWake: () => {
      requests++;
      return wake.promise;
    },
  };
  const resources = new BrowserResources(
    {
      lifecycle: (suspended, warnHost) => lifecycle.push([suspended, warnHost]),
      shouldWarnBeforeUnload: () => true,
      wakeChanged: (value) => held.push(value),
    },
    environment,
  );
  return {
    resources,
    window,
    document,
    audio,
    wake,
    sentinel,
    lifecycle,
    held,
    callbacks,
    hide: (value: boolean) => {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    counts: () => ({ listeners, closes, requests, releases }),
  };
}
void test('browser listeners start once, preserve page suspension, and retire retained callbacks', () => {
  const h = fixture();
  h.resources.start();
  h.resources.start();
  assert.equal(h.counts().listeners, 4);
  h.window.dispatchEvent(new Event('pagehide'));
  h.hide(false);
  assert.equal(h.resources.suspended, true);
  h.window.dispatchEvent(new Event('pageshow'));
  assert.deepEqual(h.lifecycle, [
    [true, false],
    [true, true],
    [false, true],
  ]);
  const unload = new Event('beforeunload', { cancelable: true });
  h.window.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  h.resources.dispose();
  h.resources.dispose();
  h.resources.start();
  assert.equal(h.counts().listeners, 0);
  for (const callback of h.callbacks) callback(new Event('stale'));
  assert.equal(h.lifecycle.length, 3);
});
void test('late audio and wake grants cannot revive disposed browser resources', async () => {
  const h = fixture();
  const unlock = h.resources.unlock();
  h.resources.dispose();
  h.audio.resolve();
  await unlock;
  assert.equal(h.counts().requests, 0);
  assert.equal(h.counts().closes, 1);
  const w = fixture();
  const first = w.resources.acquireWake(),
    second = w.resources.acquireWake();
  assert.equal(w.counts().requests, 1);
  w.resources.dispose();
  w.wake.resolve(w.sentinel);
  await Promise.all([first, second]);
  assert.equal(w.counts().releases, 1);
  assert.ok(!w.held.includes(true));
});
void test('released wake locks can be reacquired and hidden grants are released', async () => {
  const h = fixture();
  h.wake.resolve(h.sentinel);
  await h.resources.acquireWake();
  assert.deepEqual(h.held, [true]);
  h.sentinel.dispatchEvent(new Event('release'));
  await h.resources.acquireWake();
  assert.equal(h.counts().requests, 2);
  h.resources.dispose();
  const w = fixture();
  const pending = w.resources.acquireWake();
  w.hide(true);
  w.wake.resolve(w.sentinel);
  await pending;
  assert.equal(w.counts().releases, 1);
  assert.ok(!w.held.includes(true));
});

void test('sound cues synthesize game-owned layers and keep framework cues independent', () => {
  const made: string[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  });
  const node = (kind: string) => {
    made.push(kind);
    return {
      type: '',
      buffer: null,
      frequency: param(),
      gain: param(),
      Q: param(),
      connect: () => {},
      start: () => {},
      stop: () => {},
    };
  };
  const audio = {
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    createGain: () => node('gain'),
    createOscillator: () => node('oscillator'),
    createBufferSource: () => node('noise'),
    createBiquadFilter: () => node('filter'),
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  } as unknown as AudioContext;
  for (const kind of ['prompt', 'end']) assert.equal(isSound(kind), true, kind);
  assert.equal(isSound('hit'), false);
  assert.equal(isSound('hit', harvestSounds), true);
  assert.equal(isSound('hit', whackSounds), false);
  for (const kind of ['pop', 'bonk', 'gold', 'boom', 'whiff'])
    assert.equal(isSound(kind, whackSounds), true, kind);
  assert.equal(isSound('toString'), false);
  playSound(audio, 'unknown');
  assert.deepEqual(made, []);
  playSound(audio, 'bonk', whackSounds);
  assert.deepEqual(
    made.filter((kind) => kind !== 'gain'),
    ['oscillator', 'noise', 'filter'],
  );
  made.length = 0;
  playSound(audio, 'hit', harvestSounds);
  assert.deepEqual(made, ['gain', 'oscillator']);
  made.length = 0;
  playSound(audio, 'new-cue', {
    'new-cue': [{ wave: 'square', from: 440, length: 0.1, gain: 0.2 }],
  });
  assert.deepEqual(made, ['gain', 'oscillator']);
  // Even an invalid override cannot replace a framework cue at playback.
  made.length = 0;
  playSound(audio, 'end', { end: [] });
  assert.deepEqual(made, ['gain', 'oscillator']);
});
