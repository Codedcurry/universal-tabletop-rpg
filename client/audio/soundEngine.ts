import { type SoundCue, type TimedSound, musicScore } from '@shared/audio';
import { displaySettings, onDisplaySettingsChange } from '../ui/displaySettings';

// The placeholder sound pack: every sound synthesized with the Web Audio API
// (oscillators, filtered noise, envelopes), so there are no files to load or
// credit. A recorded pack can replace these recipes later.
//
// Browsers only allow audio after the person interacts with the page, so
// the engine wakes on the first press or key and stays quiet until then.

type Recipe = (ctx: AudioContext, out: AudioNode, t: number, noise: AudioBuffer) => void;

/** A tone with a quick attack and an exponential fade. */
function tone(ctx: AudioContext, out: AudioNode, t: number, options: {
  type?: OscillatorType;
  from: number;
  to?: number;
  length: number;
  volume: number;
  attack?: number;
}): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(options.from, t);
  if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, t + options.length);
  const attack = options.attack ?? 0.005;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(options.volume, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + options.length);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + options.length + 0.05);
}

/** A burst of filtered noise (whooshes, thuds, clicks, rattles). */
function burst(ctx: AudioContext, out: AudioNode, t: number, noise: AudioBuffer, options: {
  filter: BiquadFilterType;
  from: number;
  to?: number;
  length: number;
  volume: number;
  q?: number;
}): void {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter;
  filter.Q.value = options.q ?? 1;
  filter.frequency.setValueAtTime(options.from, t);
  if (options.to) filter.frequency.exponentialRampToValueAtTime(options.to, t + options.length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + options.length);
  source.connect(filter).connect(gain).connect(out);
  source.start(t, Math.random() * 0.5);
  source.stop(t + options.length + 0.05);
}

const note = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const RECIPES: Record<SoundCue, Recipe> = {
  click: (ctx, out, t) => tone(ctx, out, t, { type: 'square', from: 1800, length: 0.03, volume: 0.04 }),
  step: (ctx, out, t, noise) => burst(ctx, out, t, noise, { filter: 'lowpass', from: 500, length: 0.07, volume: 0.25 }),
  swing: (ctx, out, t, noise) => burst(ctx, out, t, noise, { filter: 'bandpass', from: 700, to: 2600, length: 0.2, volume: 0.35, q: 2 }),
  shoot: (ctx, out, t, noise) => {
    tone(ctx, out, t, { type: 'triangle', from: 260, to: 120, length: 0.18, volume: 0.25 });
    burst(ctx, out, t + 0.02, noise, { filter: 'highpass', from: 2500, length: 0.15, volume: 0.15 });
  },
  spell: (ctx, out, t) => {
    for (const [i, pitch] of [84, 88, 91, 96].entries()) tone(ctx, out, t + i * 0.05, { from: note(pitch), length: 0.6, volume: 0.07, attack: 0.03 });
  },
  item: (ctx, out, t) => tone(ctx, out, t, { from: 380, to: 820, length: 0.14, volume: 0.15 }),
  hit: (ctx, out, t, noise) => {
    tone(ctx, out, t, { from: 140, to: 50, length: 0.18, volume: 0.45 });
    burst(ctx, out, t, noise, { filter: 'lowpass', from: 1800, length: 0.06, volume: 0.3 });
  },
  miss: (ctx, out, t, noise) => burst(ctx, out, t, noise, { filter: 'bandpass', from: 1500, to: 600, length: 0.25, volume: 0.15, q: 1.5 }),
  block: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'square', from: 620, length: 0.12, volume: 0.08 });
    tone(ctx, out, t, { type: 'square', from: 955, length: 0.1, volume: 0.06 });
  },
  downed: (ctx, out, t, noise) => {
    tone(ctx, out, t, { from: 90, to: 38, length: 0.45, volume: 0.5 });
    burst(ctx, out, t, noise, { filter: 'lowpass', from: 600, length: 0.2, volume: 0.3 });
  },
  heal: (ctx, out, t) => {
    for (const [i, pitch] of [79, 84, 88].entries()) tone(ctx, out, t + i * 0.08, { from: note(pitch), length: 0.35, volume: 0.1 });
  },
  status: (ctx, out, t) => tone(ctx, out, t, { type: 'triangle', from: 330, to: 220, length: 0.3, volume: 0.12 }),
  levelUp: (ctx, out, t) => {
    for (const [i, pitch] of [72, 76, 79, 84, 88].entries()) tone(ctx, out, t + i * 0.07, { type: 'triangle', from: note(pitch), length: 0.4, volume: 0.12 });
  },
  victory: (ctx, out, t) => {
    for (const [i, pitch] of [72, 76, 79].entries()) tone(ctx, out, t + i * 0.14, { type: 'square', from: note(pitch), length: 0.2, volume: 0.06 });
    for (const pitch of [72, 76, 79, 84]) tone(ctx, out, t + 0.45, { type: 'square', from: note(pitch), length: 0.9, volume: 0.05, attack: 0.02 });
  },
  yourTurn: (ctx, out, t) => {
    tone(ctx, out, t, { from: note(84), length: 0.8, volume: 0.12 });
    tone(ctx, out, t, { from: note(96), length: 0.5, volume: 0.05 });
  },
  diceRattle: (ctx, out, t, noise) => {
    for (const offset of [0, 0.06, 0.11, 0.19, 0.24, 0.33, 0.4]) {
      burst(ctx, out, t + offset, noise, { filter: 'bandpass', from: 2400 + offset * 2000, length: 0.03, volume: 0.18, q: 4 });
    }
  },
  diceClack: (ctx, out, t, noise) => {
    tone(ctx, out, t, { from: 950, to: 520, length: 0.06, volume: 0.25 });
    burst(ctx, out, t, noise, { filter: 'highpass', from: 3000, length: 0.02, volume: 0.2 });
  },
  coinClink: (ctx, out, t) => {
    tone(ctx, out, t, { from: 2500, length: 0.35, volume: 0.08 });
    tone(ctx, out, t, { from: 3720, length: 0.25, volume: 0.05 });
  },
  critSting: (ctx, out, t) => {
    for (const pitch of [84, 88, 91, 96]) tone(ctx, out, t, { type: 'triangle', from: note(pitch), length: 0.9, volume: 0.08, attack: 0.01 });
  },
  fumbleSting: (ctx, out, t) => tone(ctx, out, t, { type: 'sawtooth', from: 300, to: 110, length: 0.6, volume: 0.08 }),
};

/** Background music: plays the written score, a little ahead of time, looping. */
class MusicPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private score = musicScore(Math.floor(Math.random() * 1_000_000));
  private loopStart = 0;
  private scheduledUpTo = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {}

  start(): void {
    if (this.timer) return;
    this.loopStart = this.ctx.currentTime + 0.1;
    this.scheduledUpTo = 0;
    this.timer = setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Queues the notes due in the next second or so. */
  private schedule(): void {
    const beat = 60 / this.score.tempo;
    const loopLength = this.score.lengthBeats * beat;
    const until = this.ctx.currentTime + 1.2 - this.loopStart;
    while (this.scheduledUpTo < until) {
      const from = this.scheduledUpTo;
      const to = Math.min(until, Math.floor(from / loopLength + 1) * loopLength);
      const loop = Math.floor(from / loopLength);
      for (const entry of this.score.notes) {
        const at = loop * loopLength + entry.at * beat;
        if (at >= from && at < to) this.play(entry.voice, entry.pitch, this.loopStart + at, entry.duration * beat);
      }
      this.scheduledUpTo = to;
    }
  }

  private play(voice: 'pad' | 'bass' | 'melody', pitch: number, t: number, length: number): void {
    const settings = { pad: { type: 'triangle', volume: 0.05, attack: 0.8 }, bass: { type: 'sine', volume: 0.12, attack: 0.05 }, melody: { type: 'triangle', volume: 0.06, attack: 0.04 } } as const;
    const { type, volume, attack } = settings[voice];
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = note(pitch);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(volume, t + Math.min(attack, length / 2));
    gain.gain.linearRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(this.out);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private effects: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private music: MusicPlayer | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    // Audio may only start after the person interacts with the page.
    const wake = () => {
      this.wake();
      window.removeEventListener('pointerdown', wake, true);
      window.removeEventListener('keydown', wake, true);
    };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    onDisplaySettingsChange(() => this.applySettings());
  }

  private wake(): void {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    this.ctx = ctx;
    this.effects = ctx.createGain();
    this.effects.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    this.music = new MusicPlayer(ctx, this.musicGain);
    this.applySettings();
  }

  private applySettings(): void {
    const { effectsVolume, musicVolume } = displaySettings();
    if (!this.ctx || !this.effects || !this.musicGain) return;
    // A gentle curve: the slider's middle sounds like half as loud.
    this.effects.gain.value = (effectsVolume / 100) ** 2;
    this.musicGain.gain.value = (musicVolume / 100) ** 2 * 0.8;
    if (musicVolume > 0) this.music?.start();
    else this.music?.stop();
  }

  /** Plays a sound now, or `delayMs` from now. Silent until the page has been interacted with, or with effects at 0. */
  play(cue: SoundCue, delayMs = 0): void {
    if (!this.ctx || !this.effects || !this.noise || displaySettings().effectsVolume === 0) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    RECIPES[cue](this.ctx, this.effects, this.ctx.currentTime + Math.max(0, delayMs) / 1000, this.noise);
  }

  /** Plays timed sounds (from shared/audio) starting now. */
  playAll(sounds: readonly TimedSound[]): void {
    for (const sound of sounds) this.play(sound.cue, sound.at);
  }
}

export const sounds = new SoundEngine();
