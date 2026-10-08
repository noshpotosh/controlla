import type { SoundLayer } from '../../api/index.ts';

export const sounds: Readonly<Record<string, readonly SoundLayer[]>> = {
  hit: [{ wave: 'sine', from: 680, length: 0.12, gain: 0.04 }],
};
