import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Host arithmetic qualification only. This does not exercise generated WASM.
const source = resolve('work/double-dash-build/vendor/dolphin/Source/Core/Core/PowerPC/Interpreter/Interpreter_FPUtils.h');
const header = readFileSync(source, 'utf8');
assert.ok(header.includes('const double c_round = Force25Bit(c);'));
assert.ok(header.includes('result.value = std::fma(a, c_round, b_sign);'));
assert.ok(header.includes('const u64 D_MASK = 0x000000001fffffff;'));
assert.ok(header.includes('const u64 EVEN_TIE = 0x0000000010000000;'));
const start = header.indexOf('inline double Force25Bit(double d)');
const end = header.indexOf('// these functions', start);
assert.ok(start >= 0 && end > start);
const rounding = header.slice(start, end);
const dir = mkdtempSync(join(tmpdir(), 'controlla-exact-madd-'));
try {
  const cpp = join(dir, 'check.cpp');
  const binary = join(dir, 'check');
  writeFileSync(cpp, `#include <bit>
#include <cmath>
#include <cstdint>
#include <cstdio>
using u64=uint64_t; using s64=int64_t; using u32=uint32_t;
namespace Common { constexpr u64 DOUBLE_EXP=0x7ff0000000000000ULL;
constexpr u64 DOUBLE_FRAC=0x000fffffffffffffULL; constexpr int DOUBLE_FRAC_WIDTH=52; }
${rounding}
int main() {
  u64 seed=0xace321ff;
  auto random=[&]() { seed^=seed<<13; seed^=seed>>7; seed^=seed<<17; return seed; };
  u64 accepted=0, ties=0, rejected=0, extended_addends=0;
  for (u32 i=0;i<2000000;++i) {
    const u32 a_bits=(u32(random())&0x807fffffU)|((1+random()%254)<<23);
    const u32 normal_b=(u32(random())&0x807fffffU)|((1+random()%254)<<23);
    const u32 b_bits=i%4==0 ? (normal_b&0x80000000U) : normal_b;
    const u64 c_bits=(random()&0x800fffffffffffffULL)|((823+random()%401)<<52);
    const double a=double(std::bit_cast<float>(a_bits));
    const u64 wide_b_bits=(random()&0x800fffffffffffffULL)|((random()%2047)<<52);
    const double b=i%4==1 ? std::bit_cast<double>(wide_b_bits) : double(std::bit_cast<float>(b_bits));
    const double c=std::bit_cast<double>(c_bits);
    const double rounded=Force25Bit(c);
    const u64 raw_round=(c_bits&0xfffffffff8000000ULL)+(c_bits&0x08000000ULL);
    if (std::bit_cast<u64>(rounded)!=raw_round) return 1;
    const double product=a*rounded;
    const double sum=product+b;
    // Conservative normal-float product bound avoids double overflow/underflow.
    if (!(std::fabs(product)>=0x1p-126 && std::fabs(product)<=0x1.fffffep127 &&
          std::fabs(sum)>=0x1p-126 && std::isnormal(float(sum)))) { ++rejected; continue; }
    if ((std::bit_cast<u64>(sum)&0x1fffffffULL)==0x10000000ULL) { ++ties; continue; }
    const double fused=std::fma(a,rounded,b);
    if (std::bit_cast<u64>(sum)!=std::bit_cast<u64>(fused) ||
        std::bit_cast<u32>(float(sum))!=std::bit_cast<u32>(float(fused))) {
      std::printf("mismatch a=%08x b=%08x c=%016llx\\n",a_bits,b_bits,(unsigned long long)c_bits); return 2;
    }
    ++accepted;
    if (i%4==1) ++extended_addends;
  }
  // Known reference tie example must remain outside the proposed fast path.
  const double a=50.0;
  const double c=double(std::bit_cast<float>(0xbc88cc38U));
  const double b=double(std::bit_cast<float>(0x1b1c72a0U));
  const double sum=a*Force25Bit(c)+b;
  if ((std::bit_cast<u64>(sum)&0x1fffffffULL)!=0x10000000ULL) return 3;
  ++ties; // Include the explicitly constructed reference tie fixture.
  if (!accepted || !extended_addends) return 4;
  std::printf("{\\"vectors\\":2000000,\\"accepted\\":%llu,\\"tiesRejected\\":%llu,\\"otherRejected\\":%llu,\\"acceptedExtendedAddends\\":%llu,\\"nativeWasmQualification\\":false}\\n",
    (unsigned long long)accepted,(unsigned long long)ties,(unsigned long long)rejected,(unsigned long long)extended_addends);
}
`);
  const compile = spawnSync('c++', ['-std=c++20', '-O2', '-ffp-contract=off', cpp, '-o', binary], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
  const result = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  process.stdout.write(result.stdout);
} finally { rmSync(dir, { recursive: true, force: true }); }
