/** Shared synthesis and framework cues; game cues arrive as declarative layers. */
import type { SoundLayer } from '../../api/index.ts';

const FRAMEWORK_SOUNDS: Readonly<Record<string, readonly SoundLayer[]>> = {
  prompt: [{ wave: 'sine', from: 420, length: 0.12, gain: 0.04 }],
  end: [{ wave: 'sine', from: 250, length: 0.12, gain: 0.04 }],
};

export function soundLayers(
  kind: string,
  sounds?: Readonly<Record<string, readonly SoundLayer[]>>,
) {
  if (Object.hasOwn(FRAMEWORK_SOUNDS, kind)) return FRAMEWORK_SOUNDS[kind];
  return sounds && Object.hasOwn(sounds, kind) ? sounds[kind] : undefined;
}
export const isSound = (
  kind: string,
  sounds?: Readonly<Record<string, readonly SoundLayer[]>>,
) => !!soundLayers(kind, sounds);

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();
function noise(audio: AudioContext) {
  let buffer = noiseBuffers.get(audio);
  if (!buffer) {
    buffer = audio.createBuffer(
      1,
      Math.ceil(audio.sampleRate * 0.6),
      audio.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(audio, buffer);
  }
  return buffer;
}

/** A steady pitch is a plain value; only sweeps schedule automation. */
function sweep(
  param: AudioParam,
  from: number,
  to: number | undefined,
  start: number,
  stop: number,
) {
  param.value = from;
  if (!to) return;
  param.setValueAtTime(from, start);
  param.exponentialRampToValueAtTime(to, stop);
}

/** Plays a named cue now; throws only if the context is unusable. */
export function playSound(
  audio: AudioContext,
  kind: string,
  sounds?: Readonly<Record<string, readonly SoundLayer[]>>,
) {
  const layers = soundLayers(kind, sounds);
  if (!layers) return;
  const now = audio.currentTime;
  for (const layer of layers) {
    const start = now + (layer.at ?? 0),
      stop = start + layer.length;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(layer.gain, start);
    gain.gain.exponentialRampToValueAtTime(0.001, stop);
    gain.connect(audio.destination);
    if ('noise' in layer) {
      const source = audio.createBufferSource(),
        filter = audio.createBiquadFilter();
      source.buffer = noise(audio);
      filter.type = layer.filter;
      filter.Q.value = layer.filter === 'bandpass' ? 1.2 : 0.7;
      sweep(filter.frequency, layer.from, layer.to, start, stop);
      source.connect(filter);
      filter.connect(gain);
      source.start(start);
      source.stop(stop + 0.02);
    } else {
      const oscillator = audio.createOscillator();
      oscillator.type = layer.wave;
      sweep(oscillator.frequency, layer.from, layer.to, start, stop);
      oscillator.connect(gain);
      oscillator.start(start);
      oscillator.stop(stop + 0.02);
    }
  }
}
