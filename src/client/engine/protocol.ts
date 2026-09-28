export interface InputFrame {
  seq: number;
  time: number;
  generation: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  buttons: number;
  edges: number[];
  edgeTimes: number[];
  confidence: number;
  values?: Record<string, unknown>;
}

export const INPUT_BYTES = 47;
export const TIME_WRAP_MS = 2 ** 32 / 1000;
export function unwrapTime(micros: number, near: number) {
  const t = micros / 1000;
  return t + Math.round((near - t) / TIME_WRAP_MS) * TIME_WRAP_MS;
}
export function newer(seq: number, old: number) {
  const delta = (seq - old + 65536) % 65536;
  return delta > 0 && delta < 32768;
}
export function encodeInput(f: InputFrame): ArrayBuffer {
  const buffer = new ArrayBuffer(INPUT_BYTES),
    d = new DataView(buffer);
  d.setUint8(0, 1);
  d.setUint16(1, f.seq, true);
  d.setUint32(3, Math.round(f.time * 1000) >>> 0, true);
  d.setUint16(7, f.generation, true);
  [f.x, f.y, f.vx, f.vy].forEach((v, i) => d.setFloat32(9 + i * 4, v, true));
  d.setUint8(25, f.buttons);
  for (let i = 0; i < 4; i++) {
    d.setUint8(26 + i, f.edges[i] ?? 0);
    d.setUint32(
      30 + i * 4,
      Math.round((f.edgeTimes[i] ?? 0) * 1000) >>> 0,
      true,
    );
  }
  d.setUint8(46, Math.round(Math.max(0, Math.min(1, f.confidence)) * 255));
  return buffer;
}
export function decodeInput(buffer: ArrayBuffer, near: number): InputFrame {
  if (buffer.byteLength !== INPUT_BYTES)
    throw new Error('Invalid input length');
  const d = new DataView(buffer);
  if (d.getUint8(0) !== 1) throw new Error('Unknown frame version');
  const values = [0, 1, 2, 3].map((i) => d.getFloat32(9 + i * 4, true));
  if (values.some((v) => !Number.isFinite(v) || Math.abs(v) > 10000))
    throw new Error('Invalid input values');
  return {
    seq: d.getUint16(1, true),
    time: unwrapTime(d.getUint32(3, true), near),
    generation: d.getUint16(7, true),
    x: values[0],
    y: values[1],
    vx: values[2],
    vy: values[3],
    buttons: d.getUint8(25),
    edges: [0, 1, 2, 3].map((i) => d.getUint8(26 + i)),
    edgeTimes: [0, 1, 2, 3].map((i) =>
      unwrapTime(d.getUint32(30 + i * 4, true), near),
    ),
    confidence: d.getUint8(46) / 255,
  };
}
export class SequenceWindow {
  newest: number | null = null;
  received = 0;
  lost = 0;
  private seen = new Set<number>();
  accept(seq: number) {
    if (this.newest === null) {
      this.newest = seq;
      this.seen.add(seq);
      this.received++;
      return true;
    }
    if (this.seen.has(seq)) return false;
    if (!newer(seq, this.newest)) {
      const age = (this.newest - seq + 65536) % 65536;
      if (age < 128) {
        this.seen.add(seq);
        this.received++;
        this.lost = Math.max(0, this.lost - 1);
      }
      return false;
    }
    this.lost += ((seq - this.newest + 65536) % 65536) - 1;
    this.newest = seq;
    this.received++;
    this.seen.add(seq);
    for (const value of this.seen)
      if ((seq - value + 65536) % 65536 >= 128) this.seen.delete(value);
    return true;
  }
  get loss() {
    return this.lost / Math.max(1, this.lost + this.received);
  }
}
