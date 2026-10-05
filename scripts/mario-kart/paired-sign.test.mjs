import assert from 'node:assert/strict';
import test from 'node:test';

function signOperation(opcodes) {
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  const body = [0, 0x20, 0, 0xbf, ...opcodes, 0xbd, 0x0b];
  return new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 1, 0x7e, 1, 0x7e]),
    ...section(3, [1, 0]), ...section(7, [1, 1, 113, 0, 0]),
    ...section(10, [1, body.length, ...body]),
  ]))).exports.q;
}
const sign = 1n << 63n;
for (const [name, ops, expected] of [
  ['neg', [0x9a], bits => bits ^ sign],
  ['abs', [0x99], bits => bits & ~sign],
  ['nabs', [0x99, 0x9a], bits => bits | sign],
  ['move', [], bits => bits],
]) {
  test(`paired ${name} preserves exact bits including signaling NaNs`, () => {
    const convert = signOperation(ops);
    const values = [0n, sign, 0x7ff0000000000000n, 0xfff0000000000000n,
      0x7ff0000000000001n, 0x7ff8123456789abcn, 0xfff8123456789abcn, 1n];
    let seed = 17n;
    for (let i = 0; i < 10000; i++) {
      seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1n);
      values.push(seed);
    }
    for (const bits of values)
      assert.equal(BigInt.asUintN(64, convert(BigInt.asIntN(64, bits))), expected(bits));
  });
}
