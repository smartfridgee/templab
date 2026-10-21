/**
 * Streaming ECG display filter.
 *
 * Chain (all second-order IIR sections, coefficients designed at runtime for the
 * actual sample rate with the RBJ "Audio EQ Cookbook" bilinear-transform formulas):
 *
 *   1. High-pass 0.5 Hz (Butterworth): removes the electrode DC offset and the
 *      baseline wander caused by breathing and movement.
 *   2. Notch 50 Hz or 60 Hz: removes powerline hum.
 *   3. Low-pass 40 Hz (Butterworth): removes EMG / high-frequency noise
 *      (standard "monitor mode" ECG bandwidth is 0.5-40 Hz).
 *
 * The SDK already delivers clean physical units (mV after the bridge's conversion).
 * This filter only cleans up the display. Each sample goes through every stage,
 * and the stage state carries over across packet boundaries.
 */

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private s1 = 0;
  private s2 = 0;

  static lowpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
    const { cos, alpha } = Biquad.params(fs, f0, q);
    return new Biquad().set((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  static highpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
    const { cos, alpha } = Biquad.params(fs, f0, q);
    return new Biquad().set((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  static notch(fs: number, f0: number, q: number): Biquad {
    const { cos, alpha } = Biquad.params(fs, f0, q);
    return new Biquad().set(1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha);
  }

  private static params(fs: number, f0: number, q: number) {
    const w0 = (2 * Math.PI * f0) / fs;
    return { cos: Math.cos(w0), alpha: Math.sin(w0) / (2 * q) };
  }

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  /** Direct Form II Transposed. */
  process(x: number): number {
    const y = this.b0 * x + this.s1;
    this.s1 = this.b1 * x - this.a1 * y + this.s2;
    this.s2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /**
   * Put the filter into the steady state it would reach with a constant input x.
   * Without this, the first sample (often a large electrode DC offset) produces a
   * multi-second high-pass transient that throws the trace off screen.
   * Returns the steady-state output.
   */
  prime(x: number): number {
    const dcGain = (this.b0 + this.b1 + this.b2) / (1 + this.a1 + this.a2);
    const y = dcGain * x;
    this.s2 = this.b2 * x - this.a2 * y;
    this.s1 = this.b1 * x - this.a1 * y + this.s2;
    return y;
  }
}

export type MainsFrequency = 50 | 60;

export interface EcgFilterOptions {
  sampleRate: number;
  highPassHz: number;
  lowPassHz: number;
  mains: MainsFrequency;
}

export const DEFAULT_FILTER_OPTIONS: EcgFilterOptions = {
  sampleRate: 250,
  highPassHz: 0.5,
  lowPassHz: 40,
  mains: 50, // Europe. Switch to 60 in the Americas.
};

export class EcgFilter {
  private stages: Biquad[] = [];
  private primed = false;
  private opts: EcgFilterOptions;

  constructor(options: Partial<EcgFilterOptions> = {}) {
    this.opts = { ...DEFAULT_FILTER_OPTIONS, ...options };
    this.design();
  }

  get options(): EcgFilterOptions {
    return { ...this.opts };
  }

  configure(options: Partial<EcgFilterOptions>): void {
    this.opts = { ...this.opts, ...options };
    this.design();
  }

  reset(): void {
    this.design();
  }

  private design(): void {
    const { sampleRate: fs, highPassHz, lowPassHz, mains } = this.opts;
    const nyquist = fs / 2;
    this.stages = [Biquad.highpass(fs, highPassHz)];
    // Only add a notch / low-pass when they sit below Nyquist for this sample rate.
    if (mains < nyquist * 0.95) this.stages.push(Biquad.notch(fs, mains, 25));
    if (lowPassHz < nyquist * 0.95) this.stages.push(Biquad.lowpass(fs, lowPassHz));
    this.primed = false;
  }

  process(x: number): number {
    if (!this.primed) {
      let v = x;
      for (const s of this.stages) v = s.prime(v);
      this.primed = true;
      return v;
    }
    let v = x;
    for (const s of this.stages) v = s.process(v);
    return v;
  }
}
