/**
 * ECG sample store, kept outside React.
 *
 * The old implementation sent every BLE packet's samples through React state.
 * React batches state updates, so when several packets came in between two
 * renders, only the last batch reached the chart and the rest were silently
 * dropped. That chopped the waveform into noise. Here every sample goes into a
 * fixed-size ring buffer synchronously, and the canvas reads it on each animation
 * frame. React never touches individual samples.
 *
 * Two parallel rings are kept, raw and filtered, so toggling the filter in the
 * UI is instant and has no transient.
 */

import { EcgFilter, EcgFilterOptions } from './ecgFilter';

const HISTORY_SECONDS = 30;
/** A jump in device timestamps larger than this resets the filter (reconnect / long dropout). */
const GAP_RESET_MS = 1000;

export class EcgBuffer {
  private fs = 250;
  private capacity = this.fs * HISTORY_SECONDS;
  private raw = new Float32Array(this.capacity);
  private filtered = new Float32Array(this.capacity);
  private filter = new EcgFilter({ sampleRate: this.fs });

  /** Absolute number of samples written since the last reset. */
  private written = 0;
  private lastTimestamp: number | null = null;
  private lastWriteAt = 0;
  /** Incremented on every reset, so consumers can detect discontinuities. */
  private epoch = 0;

  get sampleRate(): number {
    return this.fs;
  }

  get total(): number {
    return this.written;
  }

  get size(): number {
    return this.capacity;
  }

  get generation(): number {
    return this.epoch;
  }

  /** performance.now() of the most recent push, 0 if none yet. */
  get lastWriteTime(): number {
    return this.lastWriteAt;
  }

  /** Oldest absolute index still available. */
  get oldest(): number {
    return Math.max(0, this.written - this.capacity);
  }

  reset(): void {
    this.written = 0;
    this.lastTimestamp = null;
    this.lastWriteAt = 0;
    this.raw.fill(0);
    this.filtered.fill(0);
    this.filter.reset();
    this.epoch++;
  }

  configureFilter(options: Partial<Omit<EcgFilterOptions, 'sampleRate'>>): void {
    this.filter.configure(options);
  }

  get filterOptions(): EcgFilterOptions {
    return this.filter.options;
  }

  /**
   * Append samples (millivolts). `timestamps` (unix ms) are optional. They are
   * used to detect dropouts, after which the filter state is restarted.
   */
  push(values: ArrayLike<number>, timestamps?: ArrayLike<number>, sampleRate?: number): void {
    if (sampleRate && sampleRate > 0 && sampleRate !== this.fs) {
      this.setSampleRate(sampleRate);
    }
    const cap = this.capacity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;

      if (timestamps) {
        const ts = timestamps[i];
        if (this.lastTimestamp !== null && (ts - this.lastTimestamp > GAP_RESET_MS || ts < this.lastTimestamp)) {
          this.filter.reset();
        }
        this.lastTimestamp = ts;
      }

      const idx = this.written % cap;
      this.raw[idx] = v;
      this.filtered[idx] = this.filter.process(v);
      this.written++;
    }
    if (values.length > 0) this.lastWriteAt = performance.now();
  }

  /** Read the sample at absolute index `i` (must be within [oldest, total)). */
  at(i: number, filtered: boolean): number {
    return (filtered ? this.filtered : this.raw)[i % this.capacity];
  }

  private setSampleRate(fs: number): void {
    this.fs = fs;
    this.capacity = Math.round(fs * HISTORY_SECONDS);
    this.raw = new Float32Array(this.capacity);
    this.filtered = new Float32Array(this.capacity);
    this.filter = new EcgFilter({ ...this.filter.options, sampleRate: fs });
    this.written = 0;
    this.lastTimestamp = null;
    this.epoch++;
  }
}

/** Single shared buffer (one device at a time). */
export const ecgBuffer = new EcgBuffer();
