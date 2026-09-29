/**
 * Built-in sound cues, synthesized with Web Audio so no audio files ship. Games
 * name a cue with a presentation event's `kind`; unknown kinds stay silent.
 */
interface Tone {
  wave: OscillatorType;
  from: number;
  to?: number;
  /** Seconds after the cue starts. */
  at?: number;
  length: number;
  gain: number;
}
interface Noise {
  noise: true;
  filter: BiquadFilterType;
  from: number;
  to?: number;
  at?: number;
  length: number;
  gain: number;
}
type Layer = Tone | Noise;

const SOUNDS: Record<string, readonly Layer[]> = {
  hit: [{ wave: 'sine', from: 680, length: 0.12, gain: 0.04 }],
  prompt: [{ wave: 'sine', from: 420, length: 0.12, gain: 0.04 }],
  end: [{ wave: 'sine', from: 250, length: 0.12, gain: 0.04 }],
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

export const isSound = (kind: string) => Object.hasOwn(SOUNDS, kind);

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
export function playSound(audio: AudioContext, kind: string) {
  const layers = SOUNDS[kind];
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
