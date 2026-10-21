/**
 * Demo simulator. Emits the same messages as the Python bridge, so the whole
 * UI pipeline (ring buffer, filter, renderer) runs exactly as with a real device.
 *
 * The synthetic ECG is a sum of Gaussian P-Q-R-S-T waves (in the spirit of the
 * McSharry ECGSYN model), sampled at exactly 250 Hz. It includes respiratory
 * sinus arrhythmia plus realistic artifacts (electrode DC offset, baseline
 * wander, 50 Hz hum, white noise), so the display filter has real work to do.
 */

import { BridgeMessage } from '../types/telemetry';

const FS = 250;
const TICK_MS = 40;

interface Wave {
  a: number; // amplitude, mV
  mu: number; // position relative to the R peak, s (scaled by sqrt(RR) where noted)
  sigma: number; // width, s
  scale: boolean; // whether timing scales with sqrt(RR) (QT adaptation)
}

const WAVES: Wave[] = [
  { a: 0.12, mu: -0.17, sigma: 0.022, scale: true }, // P
  { a: -0.1, mu: -0.035, sigma: 0.01, scale: false }, // Q
  { a: 1.1, mu: 0, sigma: 0.011, scale: false }, // R
  { a: -0.22, mu: 0.035, sigma: 0.012, scale: false }, // S
  { a: 0.3, mu: 0.26, sigma: 0.045, scale: true }, // T
];

export class EcgSimulator {
  private timer: number | null = null;
  private emit: ((msg: BridgeMessage) => void) | null = null;

  private startWall = 0;
  private n = 0; // samples generated
  private beats: { t: number; rr: number }[] = [];
  private baseHr = 72;
  private upsideDown = false;
  private lastVitalsAt = -1;
  private battery = 87;
  private steps = 1240;

  get isRunning(): boolean {
    return this.timer !== null;
  }

  get isUpsideDown(): boolean {
    return this.upsideDown;
  }

  start(emit: (msg: BridgeMessage) => void): void {
    this.stop();
    this.emit = emit;
    this.startWall = Date.now();
    this.n = 0;
    this.beats = [{ t: 0.3, rr: 60 / this.baseHr }];
    this.lastVitalsAt = -1;

    emit({
      type: 'status',
      state: 'connected',
      device: {
        address: 'SIMULATOR',
        name: 'Aidmed One (Demo)',
        firmwareRevision: '3.8.120',
        hardwareRevision: 'Rev 1.2',
        serialNumber: 'DEMO-0001',
        manufacturer: 'Aidlab (simulated)',
      },
    });
    emit({ type: 'wear_state', value: 'proper' });
    emit({ type: 'log', level: 'success', message: 'Demo simulator started (synthetic 250 Hz ECG).' });

    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.emit) {
      this.emit({ type: 'status', state: 'idle', device: null });
      this.emit = null;
    }
  }

  toggleUpsideDown(): boolean {
    this.upsideDown = !this.upsideDown;
    this.emit?.({ type: 'wear_state', value: this.upsideDown ? 'upside_down' : 'proper' });
    return this.upsideDown;
  }

  private tick(): void {
    const emit = this.emit;
    if (!emit) return;

    const target = Math.floor(((Date.now() - this.startWall) / 1000) * FS);
    if (target <= this.n) return;

    const t: number[] = [];
    const v: number[] = [];
    for (; this.n < target; this.n++) {
      const time = this.n / FS;
      this.scheduleBeats(time, emit);
      let mv = this.cardiac(time);
      if (this.upsideDown) mv = -mv;
      mv += this.artifacts(time);
      t.push(this.startWall + Math.round((this.n * 1000) / FS));
      v.push(Math.round(mv * 1e5) / 1e5);
    }
    emit({ type: 'ecg', fs: FS, t, v });

    const sec = Math.floor(this.n / FS);
    if (sec !== this.lastVitalsAt) {
      this.lastVitalsAt = sec;
      this.vitals(sec, emit);
    }
  }

  private scheduleBeats(time: number, emit: (msg: BridgeMessage) => void): void {
    let last = this.beats[this.beats.length - 1];
    // Keep at least one future beat scheduled so T waves overlap correctly.
    while (last.t < time + 0.6) {
      this.baseHr = Math.min(85, Math.max(62, this.baseHr + (Math.random() - 0.5) * 0.8));
      const rsa = 1 + 0.045 * Math.sin(2 * Math.PI * 0.25 * last.t); // breathing ~15/min
      const rr = (60 / this.baseHr) * rsa * (1 + (Math.random() - 0.5) * 0.02);
      last = { t: last.t + rr, rr };
      this.beats.push(last);
    }
    // Report a beat when its R peak is reached. beats[0] stays the most recent past beat,
    // whose T wave may still be in progress.
    while (this.beats.length > 1 && this.beats[1].t <= time) {
      this.beats.shift();
      const rrMs = Math.round(this.beats[0].rr * 1000);
      emit({ type: 'rr', value: rrMs });
      emit({ type: 'heart_rate', value: Math.round(60000 / rrMs) });
    }
  }

  private cardiac(time: number): number {
    let mv = 0;
    for (const beat of this.beats) {
      const dt = time - beat.t;
      if (dt < -0.4 || dt > 0.7) continue;
      const s = Math.sqrt(beat.rr);
      for (const w of WAVES) {
        const mu = w.scale ? w.mu * s : w.mu;
        const sigma = w.scale ? w.sigma * s : w.sigma;
        const z = (dt - mu) / sigma;
        mv += w.a * Math.exp(-0.5 * z * z);
      }
    }
    return mv;
  }

  private artifacts(time: number): number {
    const dcOffset = 0.8; // electrode half-cell offset
    const wander = 0.15 * Math.sin(2 * Math.PI * 0.22 * time) + 0.05 * Math.sin(2 * Math.PI * 0.07 * time);
    const hum = 0.04 * Math.sin(2 * Math.PI * 50 * time);
    const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 0.02;
    return dcOffset + wander + hum + noise;
  }

  private vitals(sec: number, emit: (msg: BridgeMessage) => void): void {
    if (sec % 5 === 0) {
      emit({ type: 'skin_temperature', value: Math.round((33.4 + 0.2 * Math.sin(sec / 60)) * 100) / 100 });
      emit({ type: 'respiration_rate', value: 14 + Math.round(Math.sin(sec / 30)) });
      emit({ type: 'signal_quality', value: 92 + Math.round(Math.random() * 6) });
    }
    if (sec % 10 === 0) emit({ type: 'battery', value: this.battery });
    if (Math.random() > 0.7) {
      this.steps += 1 + Math.floor(Math.random() * 3);
      emit({ type: 'steps', value: this.steps });
    }
  }
}

export const ecgSimulator = new EcgSimulator();
