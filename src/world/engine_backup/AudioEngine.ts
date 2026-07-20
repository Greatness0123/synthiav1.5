/**
 * Tone.js integration for piano synthesis and collision sounds.
 */

import * as Tone from 'tone';
import { logger as Logger } from '../../utils/logger';

export class AudioEngine {
  private sampler: Tone.Sampler | null = null;
  private masterOutput: any = null;
  private analyser: Tone.Analyser | null = null;
  private initialized = false;

  public async init(): Promise<void> {
    // Basic init that doesn't create nodes requiring user gesture if possible,
    // but Tone.Sampler and MediaStreamDestination usually do.
    // We'll move the heavy lifting to initialize() called on first interaction.
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.masterOutput = (Tone.getContext().rawContext as AudioContext).createMediaStreamDestination();

      // Connect master output to an analyser for PCM extraction
      this.analyser = new Tone.Analyser("waveform", 2048);
      Tone.getDestination().connect(this.analyser);
      Tone.getDestination().connect(this.masterOutput);

      this.sampler = new Tone.Sampler({
        urls: {
          A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3",
          "F#1": "Fs1.mp3", A1: "A1.mp3", C2: "C2.mp3",
          "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3",
          C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
          A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3",
          "F#4": "Fs4.mp3", A4: "A4.mp3", C5: "C5.mp3",
          "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
          C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
          A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3",
          "F#7": "Fs7.mp3", A7: "A7.mp3", C8: "C8.mp3"
        },
        baseUrl: "https://tonejs.github.io/audio/salamander/"
      }).toDestination();

      await Tone.loaded();
      this.initialized = true;
      Logger.info('AudioEngine: Tone.js initialized');
    } catch (error) {
      Logger.error('AudioEngine: Failed to initialize Tone.js', error);
    }
  }

  public playNote(note: string, velocity: number = 1): void {
    if (!this.initialized || !this.sampler) return;
    this.sampler.triggerAttackRelease(note, "4n", undefined, velocity);
  }

  public playCollisionSound(impact: number): void {
    if (!this.initialized || impact < 0.5) return;
    const noise = new Tone.Noise("white").start();
    const filter = new Tone.Filter(2000, "lowpass").toDestination();
    noise.connect(filter);

    const env = new Tone.AmplitudeEnvelope({
      attack: 0.001,
      decay: 0.05,
      sustain: 0,
      release: 0.05
    }).connect(filter);

    env.triggerAttackRelease(0.05);
    setTimeout(() => noise.stop(), 100);
  }

  public getStream(): MediaStream | null {
    return this.masterOutput?.stream || null;
  }

  public async getBuffer(): Promise<Float32Array | null> {
    if (!this.initialized || !this.analyser) return null;

    // Returns the current waveform buffer (last 2048 samples)
    const data = this.analyser.getValue() as Float32Array;
    const rms = Math.sqrt(data.reduce((s, v) => s + v*v, 0) / data.length);
    if (rms < 0.001) return null;  // silent — omit audio this cycle

    return data;
  }
}
