/**
 * Clinical-grade Digital Signal Processing (DSP) filter pipeline for ECG telemetry.
 *
 * Designed for 250 Hz Aidmed One / Aidlab stream:
 * 1. High-Pass Filter (0.67 Hz): Strips DC offset & baseline wander from thoracic breathing.
 * 2. 50 Hz & 60 Hz Notch Filters: Sharp biquads eliminating powerline electromagnetic hum.
 * 3. Low-Pass Filter (40 Hz): Butterworth filter eliminating EMG muscle tremor and RF noise.
 *
 * Implemented in Direct Form II Transposed structure for maximal floating-point stability
 * and zero phase-discontinuity across streaming BLE packet boundaries.
 */

class BiquadFilter {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;

  private s1: number = 0;
  private s2: number = 0;

  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }

  public process(x: number): number {
    const y = this.b0 * x + this.s1;
    this.s1 = this.b1 * x - this.a1 * y + this.s2;
    this.s2 = this.b2 * x - this.a2 * y;
    return y;
  }

  public reset(): void {
    this.s1 = 0;
    this.s2 = 0;
  }
}

export type NotchFrequency = '50Hz' | '60Hz' | 'both' | 'off';

export interface EcgFilterOptions {
  enableBaselineCorrection?: boolean;
  enableLowPass?: boolean;
  notch?: NotchFrequency;
  invertPolarity?: boolean;
}

export class EcgFilterPipeline {
  // Pre-calculated bilinear transform coefficients at fs = 250 Hz:
  
  // High-pass Butterworth 2nd order (fc = 0.67 Hz)
  private hpf = new BiquadFilter(
    0.9881636781980074,
    -1.9763273563960149,
    0.9881636781980074,
    -1.9761872529749724,
    0.9764674598170574
  );

  // Mains 50 Hz Notch (Q = 8)
  private notch50 = new BiquadFilter(
    0.9438939681794526,
    -0.5833585541109134,
    0.9438939681794526,
    -0.5833585541109134,
    0.8877879363589052
  );

  // Mains 60 Hz Notch (Q = 8)
  private notch60 = new BiquadFilter(
    0.9412857301395386,
    -0.1182076400419817,
    0.9412857301395386,
    -0.1182076400419817,
    0.8825714602790774
  );

  // Low-pass Butterworth 2nd order (fc = 40 Hz)
  private lpf = new BiquadFilter(
    0.14532388387704243,
    0.29064776775408485,
    0.14532388387704243,
    -0.6710290907740962,
    0.2523246262822659
  );

  private options: Required<EcgFilterOptions> = {
    enableBaselineCorrection: true,
    enableLowPass: true,
    notch: 'both',
    invertPolarity: false,
  };

  constructor(options?: EcgFilterOptions) {
    if (options) {
      this.setOptions(options);
    }
  }

  public setOptions(opts: Partial<EcgFilterOptions>): void {
    this.options = {
      ...this.options,
      ...opts,
    };
  }

  public getOptions(): Required<EcgFilterOptions> {
    return { ...this.options };
  }

  public reset(): void {
    this.hpf.reset();
    this.notch50.reset();
    this.notch60.reset();
    this.lpf.reset();
  }

  /**
   * Filter an individual sample
   */
  public processSample(x: number): number {
    let out = x;

    // 1. High-pass filter (DC drift / respiration baseline wander)
    if (this.options.enableBaselineCorrection) {
      out = this.hpf.process(out);
    }

    // 2. Powerline mains hum notch filters
    if (this.options.notch === '50Hz' || this.options.notch === 'both') {
      out = this.notch50.process(out);
    }
    if (this.options.notch === '60Hz' || this.options.notch === 'both') {
      out = this.notch60.process(out);
    }

    // 3. Low-pass filter (EMG muscle tremor & high frequency spikes)
    if (this.options.enableLowPass) {
      out = this.lpf.process(out);
    }

    // 4. Polarity adjustment (for upside-down sensor placement)
    if (this.options.invertPolarity) {
      out = -out;
    }

    return out;
  }

  /**
   * Filter an array of continuous samples
   */
  public processBatch(samples: number[]): number[] {
    const result: number[] = new Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      result[i] = this.processSample(samples[i]);
    }
    return result;
  }
}
