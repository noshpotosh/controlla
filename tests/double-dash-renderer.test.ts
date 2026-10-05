import assert from 'node:assert/strict';
import test from 'node:test';
import { DoubleDashRenderer } from '../src/client/minigames/double-dash/renderer.ts';
import { neutralController } from '../src/client/minigames/double-dash/game.ts';
import type { DoubleDashState } from '../src/client/minigames/double-dash/game.ts';
import type { Presentation } from '../src/client/api/index.ts';

void test('room stage refreshes input independently of presentation time and removes its frame', (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const messages: unknown[] = [], frames: { removed: boolean }[] = [];
  const parent = { append() {} };
  const install = (key: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
  };
  install('location', { origin: 'http://localhost:3000' });
  install('document', { createElement(name: string) {
    assert.equal(name, 'iframe');
    const frame = { style: {}, removed: false,
      contentWindow: { postMessage(message: unknown, origin: string) {
        assert.equal(origin, 'http://localhost:3000'); messages.push(message);
      } }, remove() { this.removed = true; } };
    frames.push(frame); return frame;
  } });
  const renderer = new DoubleDashRenderer();
  const presentation = { context: { canvas: { parentElement: parent }, fillRect() {} },
    snapshot: { state: { controllers: [neutralController()] } }, time: 9000, width: 640, height: 480,
  } as unknown as Presentation<DoubleDashState>;
  renderer.render(presentation);
  now = 10; renderer.render(presentation);
  assert.equal(messages.length, 1);
  now = 40; presentation.time = 1000; renderer.render(presentation);
  assert.equal(messages.length, 2);
  renderer.dispose();
  assert.equal(frames[0].removed, true);
  renderer.render(presentation);
  assert.equal(frames.length, 2);
  assert.equal(messages.length, 3);
  renderer.dispose();
  assert.equal(frames[1].removed, true);
});
