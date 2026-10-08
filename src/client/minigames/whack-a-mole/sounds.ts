import type { SoundLayer } from '../../api/index.ts';

export const sounds: Readonly<Record<string, readonly SoundLayer[]>> = {
  // A soft bloop as a mole pops up.
  pop: [{ wave: 'sine', from: 360, to: 720, length: 0.09, gain: 0.03 }],
  // A cartoon bonk: a falling knock with a wooden click on top.
  bonk: [
    { wave: 'triangle', from: 560, to: 170, length: 0.16, gain: 0.12 },
    { noise: true, filter: 'bandpass', from: 1900, length: 0.04, gain: 0.08 },
  ],
  // A bright sparkle arpeggio for golden moles.
  gold: [
    { wave: 'triangle', from: 560, to: 190, length: 0.14, gain: 0.08 },
    { wave: 'sine', from: 988, at: 0.02, length: 0.12, gain: 0.05 },
    { wave: 'sine', from: 1319, at: 0.08, length: 0.12, gain: 0.05 },
    { wave: 'sine', from: 1760, at: 0.14, length: 0.2, gain: 0.05 },
  ],
  // A thump and a rumbling burst of noise.
  boom: [
    { wave: 'sine', from: 120, to: 38, length: 0.5, gain: 0.22 },
    {
      noise: true,
      filter: 'lowpass',
      from: 1400,
      to: 120,
      length: 0.6,
      gain: 0.3,
    },
  ],
  // Air rushing past for a miss.
  whiff: [
    {
      noise: true,
      filter: 'bandpass',
      from: 2600,
      to: 500,
      length: 0.16,
      gain: 0.05,
    },
  ],
};
