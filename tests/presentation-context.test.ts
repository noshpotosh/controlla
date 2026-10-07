import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type {
  GameDescriptor,
  Point,
  Presentation,
  RoundSnapshot,
} from '../src/client/api/index.ts';
import { createScreen } from '../src/client/game-screen/screen.ts';
import { createPresenter } from '../src/client/game-screen/presenter.ts';
import { NeonHarvestRenderer } from '../src/client/minigames/neon-harvest/renderer.ts';
import {
  HARVEST,
  type NeonHarvestState,
} from '../src/client/minigames/neon-harvest/model.ts';
import { neonHarvest } from '../src/client/minigames/neon-harvest/index.ts';

function canvasContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  let depth = 0;
  const values: Record<string, unknown> = {
    createRadialGradient: () => ({ addColorStop() {} }),
    save() {
      depth++;
    },
    restore() {
      depth--;
    },
  };
  const context = new Proxy(values, {
    get(target, key) {
      if (typeof key !== 'string') return Reflect.get(target, key);
      if (typeof target[key] === 'function') return target[key];
      if (key in target) return target[key];
      return (...args: unknown[]) => calls.push({ name: key, args });
    },
    set(target, key, value) {
      Reflect.set(target, key, value);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    context,
    calls,
    depth: () => depth,
    clear: () => {
      calls.length = 0;
    },
  };
}
function cachedCanvas(t: TestContext) {
  const caches: {
    width: number;
    height: number;
    getContext(): CanvasRenderingContext2D;
  }[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement() {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => canvasContext().context,
        };
        caches.push(canvas);
        return canvas;
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  return caches;
}
function snapshot(): RoundSnapshot<NeonHarvestState> {
  const playerState = {
    chain: 5,
    bestChain: 8,
    collected: 12,
    mineHits: 1,
    lastPickupAt: 1500,
    stunnedUntil: 0,
    pulseReadyAt: 3000,
  };
  return {
    schemaVersion: 2,
    timing: neonHarvest.timing,
    seed: 3000,
    assignments: ['a', 'b', 'offline'].map((playerId) => ({
      playerId,
      role: 'default',
      controls: neonHarvest.controls,
    })),
    roundId: 'round-a',
    gameId: 'neon-harvest',
    mode: 'standard',
    phase: 'running',
    startAt: 0,
    endAt: HARVEST.duration,
    players: ['a', 'b', 'offline'].map((id, seat) => ({
      id,
      venueId: 'host',
      seat,
      name: id,
      color: '#b6ff65',
      connected: id !== 'offline',
    })),
    state: {
      scores: { a: 12, b: 8, offline: 1 },
      nodes: [],
      effects: [],
      wave: 3,
      players: {
        a: { ...playerState },
        b: { ...playerState },
        offline: { ...playerState },
      },
    },
    cursors: {
      a: { x: 0.2, y: 0.3 },
      b: { x: 0.7, y: 0.6 },
      offline: { x: 0.5, y: 0.5 },
    },
    events: [],
    outcomes: [],
    progress: { revision: 1, totals: { a: 0, b: 0, offline: 0 }, awards: {} },
    error: null,
  };
}

void test('presentation receives detached deeply frozen local cursors and explicit reduced motion without authority', () => {
  let received: Presentation<NeonHarvestState> | undefined;
  const descriptor: GameDescriptor<NeonHarvestState> = {
    ...neonHarvest,
    createRenderer: () => ({
      render(presentation) {
        received = presentation;
      },
      dispose() {},
    }),
  };
  const screen = createScreen(descriptor);
  const state = snapshot();
  const local = {
    a: { x: 0.8, y: 0.4 },
    offline: { x: 0.1, y: 0.2 },
    intruder: { x: 0.1, y: 0.2 },
    b: { x: NaN, y: 0.2 },
  };
  screen.render(
    canvasContext().context,
    state,
    2000,
    800,
    450,
    local,
    100,
    true,
  );
  assert.ok(received);
  assert.equal(received.reducedMotion, true);
  assert.deepEqual(received.localCursors, { a: { x: 0.8, y: 0.4 } });
  assert.ok(Object.isFrozen(received.localCursors));
  assert.ok(Object.isFrozen(received.localCursors.a));
  assert.notEqual(received.localCursors.a, local.a);
  assert.ok(Object.isFrozen(received.snapshot.state));
  assert.equal('complete' in received, false);
  assert.equal('runtime' in received, false);
  assert.throws(() => {
    (received!.localCursors!.a as Point).x = 99;
  }, TypeError);
  local.a.x = 0.1;
  assert.equal(received.localCursors.a.x, 0.8);
  assert.equal(state.cursors.a.x, 0.2);
  screen.dispose();
});

void test('presenter forwards the preference and framework alone handles countdown, settling label and results', () => {
  let draws = 0;
  let preference: boolean | undefined;
  const descriptor: GameDescriptor<NeonHarvestState> = {
    ...neonHarvest,
    createRenderer: () => ({
      render(presentation) {
        draws++;
        preference = presentation.reducedMotion;
      },
      dispose() {},
    }),
  };
  const presenter = createPresenter([descriptor]);
  const snapshotState = snapshot();
  const frame = {
    snapshot: snapshotState,
    presentationTime: 2000,
    delay: 100,
    localCursors: {},
    status: 'ready' as const,
    message: null,
  };
  const canvas = canvasContext();
  presenter.render(canvas.context, frame, 800, 450, true);
  assert.equal(preference, true);
  snapshotState.phase = 'countdown';
  presenter.render(canvas.context, frame, 800, 450, true);
  assert.equal(draws, 1);
  snapshotState.phase = 'settling';
  presenter.render(canvas.context, frame, 800, 450, true);
  assert.equal(draws, 2);
  assert.ok(
    canvas.calls.some(
      (call) => call.name === 'fillText' && call.args[0] === 'Finishing round…',
    ),
  );
  snapshotState.phase = 'results';
  presenter.render(canvas.context, frame, 800, 450, true);
  assert.equal(draws, 2);
  assert.ok(
    canvas.calls.some(
      (call) => call.name === 'fillText' && call.args[0] === 'Round results',
    ),
  );
  assert.equal(canvas.depth(), 0);
  presenter.dispose();
});

void test('Neon ships use immediate local positions, delayed remote positions and eligible connected identities only', (t) => {
  const caches = cachedCanvas(t);
  const renderer = new NeonHarvestRenderer();
  const canvas = canvasContext();
  const state = snapshot();
  const original = structuredClone(state);
  renderer.render({
    context: canvas.context,
    snapshot: state,
    time: 2000,
    delay: 100,
    width: 800,
    height: 450,
    localCursors: {
      a: { x: 0.8, y: 0.4 },
      offline: { x: 0.1, y: 0.1 },
      intruder: { x: 0.4, y: 0.4 },
    },
    reducedMotion: true,
  });
  const translations = canvas.calls
    .filter((call) => call.name === 'translate')
    .map((call) => call.args);
  assert.ok(translations.some(([x, y]) => x === 1280 && y === 360));
  assert.ok(translations.some(([x, y]) => x === 1120 && y === 540));
  assert.equal(
    translations.some(([x, y]) => x === 160 && y === 90),
    false,
  );
  assert.equal(
    translations.some(([x, y]) => x === 640 && y === 360),
    false,
  );
  assert.ok(
    canvas.calls.some(
      (call) =>
        call.name === 'scale' && call.args[0] === 0.5 && call.args[1] === 0.5,
    ),
  );
  assert.deepEqual(state, original);
  assert.equal(canvas.depth(), 0);
  assert.equal(caches.length, 1);
  state.phase = 'settling';
  canvas.clear();
  renderer.render({
    context: canvas.context,
    snapshot: state,
    time: state.endAt,
    delay: 100,
    width: 1600,
    height: 900,
    localCursors: { a: { x: 0.1, y: 0.1 } },
  });
  assert.ok(
    canvas.calls.some(
      (call) =>
        call.name === 'translate' &&
        call.args[0] === 1280 &&
        call.args[1] === 360,
    ),
  );
  renderer.dispose();
  renderer.dispose();
  assert.equal(caches[0].width, 0);
  assert.equal(caches[0].height, 0);
  canvas.clear();
  renderer.render({
    context: canvas.context,
    snapshot: state,
    time: 2000,
    delay: 100,
    width: 1600,
    height: 900,
  });
  assert.equal(canvas.calls.length, 0);
});

void test('Neon effects and trails remain bounded and reduced motion removes cosmetic debris and trails', (t) => {
  cachedCanvas(t);
  const state = snapshot();
  state.state!.nodes = [
    { id: 1, kind: 'spark', x: 0.2, y: 0.4, bornAt: 0, expiresAt: 4000 },
    { id: 2, kind: 'gold', x: 0.4, y: 0.4, bornAt: 0, expiresAt: 4000 },
    { id: 3, kind: 'mine', x: 0.6, y: 0.4, bornAt: 0, expiresAt: 4000 },
  ];
  state.state!.effects = Array.from(
    { length: HARVEST.maxEffects },
    (_, id) => ({
      id,
      kind: 'pickup',
      playerId: 'a',
      x: 0.3,
      y: 0.3,
      at: 1950,
      points: 10,
    }),
  );
  const normal = new NeonHarvestRenderer(),
    reduced = new NeonHarvestRenderer();
  const normalCanvas = canvasContext(),
    reducedCanvas = canvasContext();
  const presentation = {
    snapshot: state,
    time: 2000,
    delay: 0,
    width: 1600,
    height: 900,
  };
  normal.render({ ...presentation, context: normalCanvas.context });
  reduced.render({
    ...presentation,
    context: reducedCanvas.context,
    reducedMotion: true,
  });
  const fills = (canvas: ReturnType<typeof canvasContext>) =>
    canvas.calls.filter((call) => call.name === 'fillRect').length;
  assert.equal(
    fills(normalCanvas) - fills(reducedCanvas),
    24 * 7,
    'at most 24 pickup bursts, with no debris under reduced motion',
  );
  state.state!.effects = [];
  let peakSegments = 0;
  for (let frame = 0; frame < 200; frame++) {
    normalCanvas.clear();
    normal.render({
      ...presentation,
      context: normalCanvas.context,
      time: 2100 + frame,
      localCursors: { a: { x: 0.2 + frame / 1000, y: 0.5 } },
    });
    peakSegments = Math.max(
      peakSegments,
      normalCanvas.calls.filter((call) => call.name === 'lineTo').length,
    );
  }
  assert.ok(peakSegments < 45, 'trail geometry cannot grow with frame count');
  normalCanvas.clear();
  normal.render({
    ...presentation,
    context: normalCanvas.context,
    time: 2350,
    reducedMotion: true,
  });
  const afterPreferenceChange = normalCanvas.calls.filter(
    (call) => call.name === 'lineTo',
  ).length;
  assert.ok(afterPreferenceChange < peakSegments);
  normal.dispose();
  reduced.dispose();
});
