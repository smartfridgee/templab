import { AidmedParameters } from '../types/bluetooth';

/**
 * Generates synthetic Aidmed One telemetry for demonstration,
 * testing, and verification when physical hardware is not immediately available.
 */
export class AidmedSimulator {
  private timer: number | null = null;
  private ecgTimer: number | null = null;
  private onDataCallback: ((params: Partial<AidmedParameters>) => void) | null = null;

  private isRunning: boolean = false;
  private isUpsideDown: boolean = false;
  private battery: number = 94;
  private currentBpm: number = 72;
  private steps: number = 1420;
  private temperature: number = 36.6;
  private ecgPhase: number = 0;
  private respirationPhase: number = 0;

  constructor() {}

  public toggleUpsideDown(): boolean {
    this.isUpsideDown = !this.isUpsideDown;
    if (this.onDataCallback) {
      this.onDataCallback({
        isUpsideDown: this.isUpsideDown,
        wearState: this.isUpsideDown ? 'upside_down' : 'proper',
        sensorContact: true,
        lastUpdated: Date.now(),
      });
    }
    return this.isUpsideDown;
  }

  public start(onData: (params: Partial<AidmedParameters>) => void): void {
    this.stop();
    this.isRunning = true;
    this.onDataCallback = onData;

    // Send initial simulated device connection
    this.onDataCallback({
      status: 'connected',
      deviceName: 'Aidmed One (Demo Simulator)',
      deviceId: 'SIM-AIDMED-01',
      batteryLevel: this.battery,
      heartRate: this.currentBpm,
      sensorContact: true,
      wearState: this.isUpsideDown ? 'upside_down' : 'proper',
      isUpsideDown: this.isUpsideDown,
      skinTemperature: this.temperature,
      respirationRate: 15,
      steps: this.steps,
      activity: 'Resting / Sitting',
      deviceInfo: {
        manufacturer: 'Aidmed Sp. z o.o.',
        modelNumber: 'Aidmed One',
        serialNumber: 'AO-2024-88412',
        firmwareRevision: '3.8.4',
        hardwareRevision: 'Rev 1.2',
      },
      lastUpdated: Date.now(),
    });

    // Slow telemetry loop (every 1 second)
    this.timer = window.setInterval(() => {
      if (!this.isRunning || !this.onDataCallback) return;

      // Slight natural variation in heart rate
      const hrDelta = Math.floor(Math.random() * 5) - 2;
      this.currentBpm = Math.max(60, Math.min(95, this.currentBpm + hrDelta));

      // Calculate RR interval
      const rrMs = Math.round((60 / this.currentBpm) * 1000);

      // Temperature slight fluctuation
      this.temperature = Math.round((36.6 + (Math.sin(Date.now() / 20000) * 0.2)) * 10) / 10;

      // Steps increment occasionally
      if (Math.random() > 0.6) {
        this.steps += Math.floor(Math.random() * 3) + 1;
      }

      this.respirationPhase += 0.15;
      const respVal = Math.round((14 + Math.sin(this.respirationPhase) * 2) * 10) / 10;

      this.onDataCallback({
        heartRate: this.currentBpm,
        rrIntervals: [rrMs],
        skinTemperature: this.temperature,
        respirationRate: respVal,
        steps: this.steps,
        batteryLevel: this.battery,
        lastUpdated: Date.now(),
      });
    }, 1000);

    // Fast ECG signal loop (every 50ms)
    this.ecgTimer = window.setInterval(() => {
      if (!this.isRunning || !this.onDataCallback) return;

      const samples: number[] = [];
      const batchSize = 3;

      for (let i = 0; i < batchSize; i++) {
        // Advance phase according to BPM
        // 1 full cardiac cycle = 60 / BPM seconds
        const cycleDuration = 60 / this.currentBpm;
        const dt = 0.05 / batchSize;
        this.ecgPhase = (this.ecgPhase + dt / cycleDuration) % 1;

        // Generate ECG P-Q-R-S-T wave point
        let mv = this.calculateEcgVoltage(this.ecgPhase);
        if (this.isUpsideDown) {
          mv = -mv; // Physical Lead I inversion when worn upside down
        }
        samples.push(mv);
      }

      this.onDataCallback({
        ecgSamples: samples,
        lastUpdated: Date.now(),
      });
    }, 50);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ecgTimer) {
      clearInterval(this.ecgTimer);
      this.ecgTimer = null;
    }
  }

  /**
   * Generates standard Lead I/II cardiac potential (mV)
   * phase is from 0.0 to 1.0 (start of P-wave to end of T-wave)
   */
  private calculateEcgVoltage(phase: number): number {
    // Baseline noise
    const noise = (Math.random() - 0.5) * 0.02;

    // P Wave: phase ~ 0.15 - 0.25
    if (phase >= 0.15 && phase <= 0.25) {
      const p = (phase - 0.2) / 0.05;
      return 0.15 * Math.exp(-0.5 * p * p * 12) + noise;
    }

    // Q Wave: phase ~ 0.35 - 0.38 (small downward deflection)
    if (phase >= 0.35 && phase < 0.38) {
      return -0.15 * Math.sin(((phase - 0.35) / 0.03) * Math.PI) + noise;
    }

    // R Wave: phase ~ 0.38 - 0.42 (sharp tall spike up to ~1.2mV)
    if (phase >= 0.38 && phase <= 0.42) {
      const r = (phase - 0.4) / 0.02;
      return 1.25 * Math.exp(-0.5 * r * r * 20) + noise;
    }

    // S Wave: phase ~ 0.42 - 0.46 (sharp downward dip)
    if (phase > 0.42 && phase <= 0.46) {
      return -0.35 * Math.sin(((phase - 0.42) / 0.04) * Math.PI) + noise;
    }

    // T Wave: phase ~ 0.55 - 0.72 (smooth rounded upward wave)
    if (phase >= 0.55 && phase <= 0.72) {
      const t = (phase - 0.635) / 0.085;
      return 0.3 * Math.exp(-0.5 * t * t * 8) + noise;
    }

    // Isoelectric baseline
    return noise;
  }
}

export const aidmedSimulator = new AidmedSimulator();
