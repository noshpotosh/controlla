import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// Independent host bit-classification check, not a WASM arithmetic substitute.
const sourceRoot = resolve('work/double-dash-build/vendor/dolphin/Source/Core');
const source = readFileSync(join(sourceRoot, 'Core/PowerPC/PowerPC.cpp'), 'utf8');
const referencePath = join(sourceRoot, 'Common/FloatUtils.cpp');
const match = source.match(/void PowerPCState::UpdateFPRFSingle\(float fvalue\)\n\{([\s\S]*?)\n\}\n/);
if (!match || !match[1].includes('WASM inline normal FPRF candidate'))
  throw new Error('Expected exact patched single-result classifier');
const directory = mkdtempSync(join(tmpdir(), 'controlla-fprf-'));
const cpp = join(directory, 'check.cpp');
const binary = join(directory, 'check');
writeFileSync(cpp, `#include <bit>
#include <cstdio>
#include "Common/FloatUtils.h"
struct State {
  struct { unsigned FPRF : 5; } fpscr{};
  void Update(float fvalue) {${match[1]}\n  }
};
int main() {
  State state;
  unsigned long long cases = 0;
  auto check = [&](u32 bits) {
    const float value = std::bit_cast<float>(bits);
    state.fpscr.FPRF = 31;
    state.Update(value);
    ++cases;
    if (state.fpscr.FPRF != Common::ClassifyFloat(value)) {
      std::printf("Mismatch %08x\\n", bits);
      return false;
    }
    return true;
  };
  // All exponent/sign classes and mantissa transitions, including sNaN/qNaN.
  const u32 mantissas[] = {0, 1, 2, 0x3fffff, 0x400000, 0x400001, 0x7ffffe, 0x7fffff};
  for (u32 sign : {0u, 0x80000000u})
    for (u32 exponent = 0; exponent < 256; ++exponent)
      for (u32 mantissa : mantissas)
        if (!check(sign | (exponent << 23) | mantissa)) return 1;
  // Deterministic additional bit patterns independent of floating arithmetic.
  u32 bits = 0x7f800001;
  for (u32 i = 0; i < 1048576; ++i) {
    bits ^= bits << 13; bits ^= bits >> 17; bits ^= bits << 5;
    if (!check(bits)) return 1;
  }
  std::printf("FPRF classification passed %llu bit-pattern comparisons\\n", cases);
}
`);
const compilation = spawnSync('/usr/bin/c++', ['-std=c++20', '-O2', '-I', sourceRoot,
  cpp, referencePath, '-o', binary], { encoding: 'utf8' });
if (compilation.status !== 0) throw new Error(compilation.stderr);
const result = spawnSync(binary, [], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stdout + result.stderr);
console.log(result.stdout.trim());
console.log(JSON.stringify({ method: 'host C++ extracted patched method versus original ClassifyFloat',
  powerPcSha256: createHash('sha256').update(source).digest('hex'),
  referenceSha256: createHash('sha256').update(readFileSync(referencePath)).digest('hex'),
  nativeWasmQualification: false }));
