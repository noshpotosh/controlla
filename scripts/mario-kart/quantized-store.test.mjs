import assert from 'node:assert/strict';
import test from 'node:test';

// Differential screen for the proposed scale-zero PSQ store emitter.
// Match Interpreter_LoadStorePaired.cpp: convert to float, clamp, truncate.
// NaNs must remain on the interpreter path rather than enter this emitter.
function quantizer(min, max) {
  const f64 = value => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    return [0x44, ...bytes];
  };
  const body = [0, 0x20, 0, 0xb6, 0xbb, ...f64(min), 0xa5,
    ...f64(max), 0xa4, 0xfc, 2, 0x0b];
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  return new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 1, 0x7c, 1, 0x7f]),
    ...section(3, [1, 0]),
    ...section(7, [1, 1, 113, 0, 0]),
    ...section(10, [1, body.length, ...body]),
  ]))).exports.q;
}

for (const [name, min, max] of [['u8', 0, 255], ['s16', -32768, 32767]]) {
  test(`scale-zero ${name} WASM conversion matches float quantization boundaries`, () => {
    const convert = quantizer(min, max);
    const values = [-Infinity, Infinity, -0, 0, min, max, min - 1, max + 1,
      min - 0.0001, max - 0.0001, -1.99999, 1.99999, 255.99999];
    let seed = 17;
    for (let i = 0; i < 10000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      values.push((seed / 0xffffffff - 0.5) * 100000);
    }
    for (const value of values) {
      const expected = Math.trunc(Math.min(max, Math.max(min, Math.fround(value))));
      assert.equal(convert(value), expected === 0 ? 0 : expected, String(value));
    }
  });
}
