import React, { useEffect, useRef, useState, useCallback } from 'react';
import { WearState } from '../types/bluetooth';
import { EcgFilterPipeline } from '../services/ecgFilter';

interface ECGMonitorProps {
  samples: number[];
  heartRate: number | null;
  sensorContact: boolean | null;
  wearState?: WearState | null;
  isUpsideDown?: boolean;
  isConnected: boolean;
  onActivateStream?: () => void;
}

const BUFFER_SIZE = 1000; // 4.0 seconds at 250 Hz

export const ECGMonitor: React.FC<ECGMonitorProps> = ({
  samples,
  heartRate,
  sensorContact,
  wearState,
  isUpsideDown = false,
  isConnected,
  onActivateStream,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dataBufferRef = useRef<number[]>([]);
  const filterRef = useRef<EcgFilterPipeline>(new EcgFilterPipeline());
  const smoothedScaleRef = useRef<number>(100);

  const [sampleCount, setSampleCount] = useState<number>(0);
  const [lastPacketTime, setLastPacketTime] = useState<number | null>(null);
  const [filterEnabled, setFilterEnabled] = useState<boolean>(true);
  const [gainMode, setGainMode] = useState<'auto' | '1x' | '2x' | '0.5x'>('auto');
  const [invertPolarity, setInvertPolarity] = useState<boolean>(false);

  // When upside-down state transitions to true, suggest inversion
  useEffect(() => {
    if (isUpsideDown) {
      setInvertPolarity(true);
    }
  }, [isUpsideDown]);

  // Sync options with DSP filter
  useEffect(() => {
    filterRef.current.setOptions({
      enableBaselineCorrection: filterEnabled,
      enableLowPass: filterEnabled,
      notch: filterEnabled ? 'both' : 'off',
      invertPolarity,
    });
  }, [filterEnabled, invertPolarity]);

  // Feed incoming raw ECG samples into DSP filter pipeline and fixed rolling buffer
  useEffect(() => {
    if (samples && samples.length > 0) {
      const buffer = dataBufferRef.current;
      const pipeline = filterRef.current;

      for (const raw of samples) {
        const processed = filterEnabled ? pipeline.processSample(raw) : (invertPolarity ? -raw : raw);
        buffer.push(processed);
        if (buffer.length > BUFFER_SIZE) {
          buffer.shift();
        }
      }

      setSampleCount((prev) => prev + samples.length);
      setLastPacketTime(Date.now());
    }
  }, [samples, filterEnabled, invertPolarity]);

  // Reset when disconnected
  useEffect(() => {
    if (!isConnected) {
      dataBufferRef.current = [];
      filterRef.current.reset();
      smoothedScaleRef.current = 100;
      setSampleCount(0);
      setLastPacketTime(null);
    }
  }, [isConnected]);

  // Canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Dark medical oscilloscope background
      ctx.fillStyle = '#070d14';
      ctx.fillRect(0, 0, width, height);

      // Draw clinical grid (25mm/s standard calibration)
      ctx.lineWidth = 1;
      const smallGrid = 15;
      const largeGrid = 75;

      // Minor grid lines (1mm standard paper equivalent)
      ctx.strokeStyle = '#0c1b23';
      ctx.beginPath();
      for (let x = 0; x < width; x += smallGrid) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += smallGrid) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Major grid lines (5mm / 0.2s standard calibration box)
      ctx.strokeStyle = '#14343e';
      ctx.beginPath();
      for (let x = 0; x < width; x += largeGrid) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += largeGrid) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Center isoelectric baseline
      const centerY = height / 2;
      ctx.strokeStyle = '#1d4852';
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      const buffer = dataBufferRef.current;

      if (!isConnected || buffer.length === 0) {
        // Flatline isoelectric baseline when disconnected or waiting
        ctx.strokeStyle = isConnected ? '#10b981' : '#64748b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px monospace';
        ctx.fillText(
          isConnected
            ? 'Waiting for ECG packages from Aidmed One... Click "Start / Resume Stream" if not started.'
            : 'Lead I / ECG Disconnected',
          20,
          centerY - 14
        );
      } else {
        // Compute gain scaling
        let scaleY: number;

        if (gainMode === '1x') {
          scaleY = 80; // 1 mV = 80px (~10 mm/mV standard)
        } else if (gainMode === '2x') {
          scaleY = 160;
        } else if (gainMode === '0.5x') {
          scaleY = 40;
        } else {
          // Auto Gain: heavily smoothed to prevent bouncing when QRS enters/exits
          let minVal = buffer[0];
          let maxVal = buffer[0];
          for (let i = 1; i < buffer.length; i++) {
            if (buffer[i] < minVal) minVal = buffer[i];
            if (buffer[i] > maxVal) maxVal = buffer[i];
          }
          const peakToPeak = Math.max(0.3, maxVal - minVal);
          const targetScale = (height * 0.62) / peakToPeak;
          const clampedTarget = Math.min(220, Math.max(45, targetScale));
          // Smooth exponential filter (alpha = 0.05)
          smoothedScaleRef.current = smoothedScaleRef.current * 0.95 + clampedTarget * 0.05;
          scaleY = smoothedScaleRef.current;
        }

        // Draw waveform trace
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#10b981';
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();

        const stepX = width / Math.max(BUFFER_SIZE - 1, buffer.length);
        const startX = width - buffer.length * stepX;

        for (let i = 0; i < buffer.length; i++) {
          const x = startX + i * stepX;
          // Invert Y so positive electrical voltage points upwards
          const y = centerY - buffer[i] * scaleY;
          const clampedY = Math.max(6, Math.min(height - 6, y));

          if (i === 0) {
            ctx.moveTo(x, clampedY);
          } else {
            ctx.lineTo(x, clampedY);
          }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw calibration marker on the left (1 mV standard reference pulse)
        ctx.strokeStyle = '#059669';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const calX = 8;
        const calH = scaleY * 1.0; // 1 mV height
        ctx.moveTo(calX, centerY);
        ctx.lineTo(calX + 6, centerY);
        ctx.lineTo(calX + 6, centerY - calH);
        ctx.lineTo(calX + 16, centerY - calH);
        ctx.lineTo(calX + 16, centerY);
        ctx.lineTo(calX + 22, centerY);
        ctx.stroke();

        ctx.fillStyle = '#10b981';
        ctx.font = '10px monospace';
        ctx.fillText('1mV', calX + 6, centerY - calH - 3);
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isConnected, gainMode]);

  const isRecentStream = lastPacketTime !== null && Date.now() - lastPacketTime < 2500;

  // Compute lead contact / wear state badge
  const getContactBadge = useCallback(() => {
    if (!isConnected) {
      return { text: 'Lead I Disconnected', cls: 'inactive' };
    }
    if (wearState === 'detached' || sensorContact === false) {
      return { text: 'Check Electrodes (Detached)', cls: 'check' };
    }
    if (wearState === 'loose') {
      return { text: 'Check Strap (Loose Contact)', cls: 'check' };
    }
    if (wearState === 'upside_down' || isUpsideDown) {
      return { text: 'Attached (Upside Down)', cls: 'upside-down' };
    }
    if (wearState === 'unsettled') {
      return { text: 'Contact Settling...', cls: 'warn' };
    }
    return { text: 'Lead Contact: Good (Upright)', cls: 'ok' };
  }, [isConnected, sensorContact, wearState, isUpsideDown]);

  const contactInfo = getContactBadge();

  return (
    <div className="ecg-monitor-card">
      <div className="ecg-monitor-header">
        <div className="ecg-title-badge">
          <span className={`ecg-live-dot ${isRecentStream ? 'live' : ''}`} />
          <span className="ecg-title">ECG Lead I (Aidmed One Real-Time Stream)</span>
          {sampleCount > 0 && (
            <span className="sample-counter-pill">
              {sampleCount.toLocaleString()} samples
            </span>
          )}
        </div>

        <div className="ecg-meta">
          {/* Upside Down Warning Pill */}
          {isUpsideDown && (
            <span className="upside-down-pill pulse" title="Sensor is placed upside-down on the chest">
              ⚠️ UPSIDE DOWN
            </span>
          )}

          <span className="ecg-scale">25 mm/s | 10 mm/mV</span>

          <span className={`contact-badge ${contactInfo.cls}`}>
            {contactInfo.text}
          </span>

          {typeof heartRate === 'number' && Number.isFinite(heartRate) && (
            <span className="ecg-hr-badge">
              <strong>{heartRate}</strong> BPM
            </span>
          )}

          {/* Quick controls toolbar */}
          <div className="ecg-toolbar">
            <button
              type="button"
              className={`btn-toolbar-toggle ${filterEnabled ? 'active' : ''}`}
              onClick={() => setFilterEnabled((prev) => !prev)}
              title="DSP Filter: 0.67 Hz High-Pass + 50/60 Hz Notch + 40 Hz Low-Pass"
            >
              {filterEnabled ? 'DSP Filter: ON' : 'DSP Filter: OFF (Raw)'}
            </button>

            <button
              type="button"
              className={`btn-toolbar-toggle ${gainMode !== 'auto' ? 'active' : ''}`}
              onClick={() => {
                const modes: Array<'auto' | '1x' | '2x' | '0.5x'> = ['auto', '1x', '2x', '0.5x'];
                const nextIdx = (modes.indexOf(gainMode) + 1) % modes.length;
                setGainMode(modes[nextIdx]);
              }}
              title="Toggle vertical display gain"
            >
              Gain: {gainMode.toUpperCase()}
            </button>

            {isConnected && onActivateStream && (
              <button
                type="button"
                className="btn-stream-action"
                onClick={onActivateStream}
                title="Send activation commands to start/resume ECG collection"
              >
                Start Stream
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Upside-Down Warning Banner */}
      {isUpsideDown && (
        <div className="ecg-upside-down-banner">
          <div className="upside-down-text">
            <span className="banner-icon">⚠️</span>
            <span>
              <strong>Device Detected Upside Down:</strong> The Aidmed One sensor is currently worn inverted on the chest.
              The Lead I electrical vector is reversed.
            </span>
          </div>
          <button
            type="button"
            className="btn-flip-waveform"
            onClick={() => setInvertPolarity((p) => !p)}
            title="Invert ECG polarity in software to display standard upright QRS complexes"
          >
            {invertPolarity ? '✓ Waveform Flipped Upright' : 'Invert Waveform Upright'}
          </button>
        </div>
      )}

      <div className="ecg-canvas-wrapper">
        <canvas ref={canvasRef} width={800} height={200} className="ecg-canvas" />
      </div>
    </div>
  );
};
