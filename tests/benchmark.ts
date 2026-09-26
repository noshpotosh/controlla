import { performance } from 'node:perf_hooks';
import { MessageChannel } from 'node:worker_threads';
const snapshot = {
  players: Array.from({ length: 8 }, (_, id) => ({
    id,
    x: 0.5,
    y: 0.5,
    vx: 0.1,
    vy: 0.2,
    buttons: 3,
    edges: [10, 4, 0, 0],
    time: performance.now(),
  })),
};
const count = 5000,
  start = performance.now();
for (let i = 0; i < count; i++) structuredClone(snapshot);
const cloneMs = (performance.now() - start) / count;
const { port1, port2 } = new MessageChannel();
let seen = 0;
const samples: number[] = [];
port2.on('message', (m) => {
  samples.push(performance.now() - m.sent);
  port2.postMessage('ack');
});
await new Promise<void>((resolve) => {
  port1.on('message', () => {
    if (++seen === count) resolve();
    else port1.postMessage({ ...snapshot, sent: performance.now() });
  });
  port1.postMessage({ ...snapshot, sent: performance.now() });
});
port1.close();
port2.close();
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      environment:
        'Node MessageChannel — browser iframe measurement still required',
      players: 8,
      rateHz: 120,
      cloneMeanMs: cloneMs,
      postMessageP50Ms: samples[Math.floor(count * 0.5)],
      postMessageP95Ms: samples[Math.floor(count * 0.95)],
      postMessageP99Ms: samples[Math.floor(count * 0.99)],
    },
    null,
    2,
  ),
);
