import type { SoundLayer } from '../api/index.ts';
import { isJsonValue } from './json.ts';
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, min: number, max: number) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
export function validSounds(
  value: unknown,
): value is Readonly<Record<string, readonly SoundLayer[]>> {
  return (
    record(value) &&
    isJsonValue(value, 16 * 1024) &&
    Object.keys(value).length <= 64 &&
    Object.entries(value).every(
      ([kind, layers]) =>
        kind.trim().length > 0 &&
        kind.length <= 64 &&
        !['prompt', 'end'].includes(kind) &&
        Array.isArray(layers) &&
        layers.length > 0 &&
        layers.length <= 8 &&
        layers.every(
          (layer: unknown) =>
            record(layer) &&
            bounded(layer.from, 20, 20000) &&
            (layer.to === undefined || bounded(layer.to, 20, 20000)) &&
            (layer.at === undefined || bounded(layer.at, 0, 2)) &&
            bounded(layer.length, Number.MIN_VALUE, 2) &&
            bounded(layer.gain, 0, 1) &&
            (layer.noise === true
              ? layer.wave === undefined &&
                [
                  'lowpass',
                  'highpass',
                  'bandpass',
                  'lowshelf',
                  'highshelf',
                  'peaking',
                  'notch',
                  'allpass',
                ].includes(layer.filter as string)
              : layer.noise === undefined &&
                layer.filter === undefined &&
                ['sine', 'square', 'sawtooth', 'triangle'].includes(
                  layer.wave as string,
                )),
        ),
    )
  );
}
export function validateSounds(value: unknown): void {
  if (value !== undefined && !validSounds(value))
    throw new Error('Invalid game sound declarations.');
}
