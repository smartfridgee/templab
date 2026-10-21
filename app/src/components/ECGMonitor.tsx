import React, { useEffect, useRef, useState } from 'react';
import { WearState } from '../types/telemetry';
import { ecgBuffer } from '../services/ecgBuffer';
import { MainsFrequency } from '../services/ecgFilter';

interface ECGMonitorProps {
  heartRate: number | null;
  signalQuality: number | null;
  wearState: WearState | null;
  isConnected: boolean;
}

type GainSetting = 'auto' | '10' | '20' | '5';
type TraceMode = 'sweep' | 'scroll';

// Standard ECG grid geometry:
//   25 mm/s horizontally -> 1 small square (1 mm) = 40 ms, 1 large square (5 mm) = 200 ms.
//   10 mm/mV vertically  -> 1 small square (1 mm) = 0.1 mV, 1 large square (5 mm) = 0.5 mV.
const PX_PER_MM = 6; // 1 small box = 6 CSS px, 1 large box = 30 CSS px, 1 s = 150 CSS px
const MM_PER_SEC = 25;
const PX_PER_SEC = PX_PER_MM * MM_PER_SEC; // 150 px/s
const CANVAS_HEIGHT_CSS = 260;

export const ECGMonitor: React.FC<ECGMonitorProps> = ({
  heartRate,
  signalQuality,
  wearState,
  isConnected,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [filtered, setFiltered] = useState<boolean>(true);
  const [mains, setMains] = useState<MainsFrequency>(50);
  const [gain, setGain] = useState<GainSetting>('10');
  const [traceMode, setTraceMode] = useState<TraceMode>('sweep');
  const [invertPolarity, setInvertPolarity] = useState<boolean>(false);
  const [sampleCount, setSampleCount] = useState<number>(0);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  const isUpsideDown = wearState === 'upside_down';

  // Auto-enable polarity inversion when device reports upside-down placement
  useEffect(() => {
    if (isUpsideDown) {
      setInvertPolarity(true);
    } else if (wearState === 'proper') {
      setInvertPolarity(false);
    }
  }, [isUpsideDown, wearState]);

  // Update notch filter frequency when toggled
  useEffect(() => {
    ecgBuffer.configureFilter({ mains });
  }, [mains]);

  // Lightweight 4 Hz UI status poll for sample counter badge (keeps React out of the 250 Hz path)
  useEffect(() => {
    const id = window.setInterval(() => {
      setSampleCount(ecgBuffer.total);
      const last = ecgBuffer.lastWriteTime;
      setIsStreaming(last > 0 && performance.now() - last < 1500);
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Keep options in a ref so the animation loop never has to restart when controls change
  const renderOptsRef = useRef({
    filtered,
    gain,
    traceMode,
    invertPolarity,
    isConnected,
  });
  renderOptsRef.current = {
    filtered,
    gain,
    traceMode,
    invertPolarity,
    isConnected,
  };

  // Main 60fps canvas oscilloscope loop reading directly from ecgBuffer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cssWidth = canvas.clientWidth || 800;
    const cssHeight = CANVAS_HEIGHT_CSS;

    const updateCanvasSize = () => {
      const dpr = window.devicePixelRatio || 1;
      cssWidth = canvas.clientWidth || 800;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    updateCanvasSize();
    const ro = new ResizeObserver(updateCanvasSize);
    ro.observe(canvas);

    // State for sweep mode and auto-gain smoothing
    const sweepBuffer = new Float32Array(4096);
    let sweepReadIndex = 0;
    let sweepCursor = 0;
    let lastGeneration = ecgBuffer.generation;
    let lastFilteredFlag = renderOptsRef.current.filtered;
    let smoothedMmPerMv = 10;

    let animId = 0;

    const drawGrid = (w: number, h: number) => {
      ctx.fillStyle = '#070d14';
      ctx.fillRect(0, 0, w, h);

      const smallStep = PX_PER_MM; // 1 mm = 6 px
      const largeStep = PX_PER_MM * 5; // 5 mm = 30 px
      const centerY = Math.round(h / 2);

      // Minor 1mm grid
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#0c1c24';
      ctx.beginPath();
      for (let x = 0; x <= w; x += smallStep) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let y = centerY % smallStep; y <= h; y += smallStep) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();

      // Major 5mm grid
      ctx.strokeStyle = '#14333d';
      ctx.beginPath();
      for (let x = 0; x <= w; x += largeStep) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      const largeOffset = ((centerY % largeStep) + largeStep) % largeStep;
      for (let y = largeOffset; y <= h; y += largeStep) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();

      // Isoelectric baseline
      ctx.strokeStyle = '#1c4652';
      ctx.beginPath();
      ctx.moveTo(0, centerY + 0.5);
      ctx.lineTo(w, centerY + 0.5);
      ctx.stroke();
    };

    const drawCalibrationPulse = (centerY: number, pxPerMv: number) => {
      // Standard 1 mV, 200 ms (5 mm) calibration square wave on the left
      const x0 = 10;
      const pulseW = 5 * PX_PER_MM; // 5 mm = 30 px
      const pulseH = pxPerMv * 1.0; // 1 mV

      ctx.save();
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, centerY);
      ctx.lineTo(x0 + 6, centerY);
      ctx.lineTo(x0 + 6, centerY - pulseH);
      ctx.lineTo(x0 + 6 + pulseW, centerY - pulseH);
      ctx.lineTo(x0 + 6 + pulseW, centerY);
      ctx.lineTo(x0 + 12 + pulseW, centerY);
      ctx.stroke();

      ctx.fillStyle = '#34d399';
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText('1 mV', x0 + 8, Math.max(12, centerY - pulseH - 5));
      ctx.restore();
    };

    const render = () => {
      const {
        filtered: useFiltered,
        gain: gainMode,
        traceMode: mode,
        invertPolarity: invert,
        isConnected: connected,
      } = renderOptsRef.current;

      const w = cssWidth;
      const h = cssHeight;
      const centerY = Math.round(h / 2);

      drawGrid(w, h);

      const total = ecgBuffer.total;
      const oldest = ecgBuffer.oldest;
      const fs = ecgBuffer.sampleRate;

      // How many samples fit across the canvas at 25 mm/s
      const windowSeconds = w / PX_PER_SEC;
      const windowSamples = Math.max(64, Math.min(sweepBuffer.length, Math.round(windowSeconds * fs)));
      const stepX = w / windowSamples;

      // Reset sweep state if buffer was reset or filter mode changed
      if (ecgBuffer.generation !== lastGeneration || useFiltered !== lastFilteredFlag) {
        lastGeneration = ecgBuffer.generation;
        lastFilteredFlag = useFiltered;
        sweepBuffer.fill(NaN);
        sweepCursor = 0;
        sweepReadIndex = Math.max(oldest, total - windowSamples);
      }

      if (!connected || total === 0) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(
          connected
            ? 'Connected — waiting for ECG samples (place electrodes on chest)...'
            : 'ECG Lead I Standby — Connect an Aidlab / Aidmed One device or enable Demo Mode',
          24,
          centerY - 14
        );
        animId = requestAnimationFrame(render);
        return;
      }

      const startIdx = Math.max(oldest, total - windowSamples);
      const count = total - startIdx;

      // In Raw mode (no high-pass filter), remove the window's static DC offset so the trace
      // stays on screen while preserving wander, mains hum, and noise for comparison.
      let dcOffset = 0;
      let minV = Infinity;
      let maxV = -Infinity;

      if (!useFiltered && count > 0) {
        let sum = 0;
        for (let i = startIdx; i < total; i++) {
          sum += ecgBuffer.at(i, false);
        }
        dcOffset = sum / count;
      }

      for (let i = startIdx; i < total; i++) {
        const v = ecgBuffer.at(i, useFiltered) - dcOffset;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }

      // Compute vertical scale (px per mV)
      let mmPerMv: number;
      if (gainMode === '10') {
        mmPerMv = 10;
      } else if (gainMode === '20') {
        mmPerMv = 20;
      } else if (gainMode === '5') {
        mmPerMv = 5;
      } else {
        const p2p = Math.max(0.35, maxV - minV);
        const targetMmPerMv = Math.min(25, Math.max(4, (h * 0.65) / (p2p * PX_PER_MM)));
        smoothedMmPerMv = smoothedMmPerMv * 0.92 + targetMmPerMv * 0.08;
        mmPerMv = smoothedMmPerMv;
      }
      const pxPerMv = mmPerMv * PX_PER_MM;
      const sign = invert ? -1 : 1;

      if (mode === 'scroll') {
        // Smooth strip-chart scrolling (newest sample on the right)
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#10b981';
        ctx.shadowColor = 'rgba(16, 185, 129, 0.45)';
        ctx.shadowBlur = 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();

        const xOffset = w - count * stepX;
        for (let i = 0; i < count; i++) {
          const v = (ecgBuffer.at(startIdx + i, useFiltered) - dcOffset) * sign;
          const x = xOffset + i * stepX;
          const y = Math.max(4, Math.min(h - 4, centerY - v * pxPerMv));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        // ICU sweep mode with erase bar
        if (sweepReadIndex < oldest) {
          sweepReadIndex = oldest;
        }
        if (total - sweepReadIndex > windowSamples) {
          sweepReadIndex = total - windowSamples;
        }
        while (sweepReadIndex < total) {
          sweepBuffer[sweepCursor] = ecgBuffer.at(sweepReadIndex, useFiltered);
          sweepCursor = (sweepCursor + 1) % windowSamples;
          sweepReadIndex++;
        }

        const gapSamples = Math.max(6, Math.round(fs * 0.12)); // 120 ms erase bar

        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#10b981';
        ctx.shadowColor = 'rgba(16, 185, 129, 0.45)';
        ctx.shadowBlur = 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();

        let penDown = false;
        for (let i = 0; i < windowSamples; i++) {
          const distAhead = (i - sweepCursor + windowSamples) % windowSamples;
          if (distAhead > 0 && distAhead < gapSamples) {
            penDown = false;
            continue;
          }
          const rawVal = sweepBuffer[i];
          if (Number.isNaN(rawVal)) {
            penDown = false;
            continue;
          }
          const v = (rawVal - dcOffset) * sign;
          const x = i * stepX;
          const y = Math.max(4, Math.min(h - 4, centerY - v * pxPerMv));
          if (!penDown) {
            ctx.moveTo(x, y);
            penDown = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();

        // Bright cursor dot at the sweep head
        const headIdx = (sweepCursor - 1 + windowSamples) % windowSamples;
        const headVal = sweepBuffer[headIdx];
        if (!Number.isNaN(headVal)) {
          const headX = headIdx * stepX;
          const headY = Math.max(4, Math.min(h - 4, centerY - (headVal - dcOffset) * sign * pxPerMv));
          ctx.fillStyle = '#6ee7b7';
          ctx.beginPath();
          ctx.arc(headX, headY, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      drawCalibrationPulse(centerY, pxPerMv);

      animId = requestAnimationFrame(render);
    };

    sweepBuffer.fill(NaN);
    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  const contactBadge = (() => {
    if (!isConnected) return { text: 'Lead I Offline', cls: 'inactive' };
    switch (wearState) {
      case 'proper':
        return { text: 'Electrodes: Good Contact', cls: 'ok' };
      case 'upside_down':
        return { text: 'Electrodes: Upside Down', cls: 'upside-down' };
      case 'loose':
        return { text: 'Electrodes: Loose Strap', cls: 'check' };
      case 'detached':
        return { text: 'Electrodes: Detached', cls: 'check' };
      case 'unsettled':
        return { text: 'Electrodes: Settling...', cls: 'warn' };
      default:
        return { text: isStreaming ? 'Streaming 250 Hz' : 'Waiting for Signal', cls: isStreaming ? 'ok' : 'warn' };
    }
  })();

  const displayedMmPerMv = gain === 'auto' ? 'AUTO' : `${gain} mm/mV`;

  return (
    <div className="ecg-monitor-card">
      <div className="ecg-monitor-header">
        <div className="ecg-title-badge">
          <span className={`ecg-live-dot ${isStreaming && isConnected ? 'live' : ''}`} />
          <span className="ecg-title">ECG Lead I • 250 Hz (Official Aidlab SDK)</span>
          {sampleCount > 0 && (
            <span className="sample-counter-pill">{sampleCount.toLocaleString()} samples</span>
          )}
        </div>

        <div className="ecg-meta">
          <span className="ecg-scale">25 mm/s | {displayedMmPerMv}</span>

          {signalQuality !== null && isConnected && (
            <span className="sample-counter-pill" title="Signal quality reported by Aidlab SDK">
              SQI {signalQuality}%
            </span>
          )}

          <span className={`contact-badge ${contactBadge.cls}`}>{contactBadge.text}</span>

          {typeof heartRate === 'number' && Number.isFinite(heartRate) && (
            <span className="ecg-hr-badge">
              <strong>{heartRate}</strong> BPM
            </span>
          )}

          <div className="ecg-toolbar">
            <button
              type="button"
              className={`btn-toolbar-toggle ${filtered ? 'active' : ''}`}
              onClick={() => setFiltered((f) => !f)}
              title="0.5–40 Hz Monitor Bandpass + Mains Notch Filter"
            >
              {filtered ? `Filter 0.5–40 Hz` : 'Filter: OFF (Raw)'}
            </button>

            {filtered && (
              <button
                type="button"
                className="btn-toolbar-toggle"
                onClick={() => setMains((m) => (m === 50 ? 60 : 50))}
                title="Toggle powerline notch frequency (50 Hz Europe / 60 Hz US)"
              >
                Notch: {mains} Hz
              </button>
            )}

            <button
              type="button"
              className="btn-toolbar-toggle"
              onClick={() => {
                const order: GainSetting[] = ['10', '20', '5', 'auto'];
                setGain(order[(order.indexOf(gain) + 1) % order.length]);
              }}
              title="Cycle vertical scale (10 mm/mV, 20 mm/mV, 5 mm/mV, Auto)"
            >
              Gain: {gain === 'auto' ? 'AUTO' : `${gain} mm/mV`}
            </button>

            <button
              type="button"
              className="btn-toolbar-toggle"
              onClick={() => setTraceMode((m) => (m === 'sweep' ? 'scroll' : 'sweep'))}
              title="Switch between ICU Sweep (erase bar) and Strip-Chart Scroll"
            >
              Mode: {traceMode === 'sweep' ? 'Sweep' : 'Scroll'}
            </button>
          </div>
        </div>
      </div>

      {isUpsideDown && (
        <div className="ecg-upside-down-banner">
          <div className="upside-down-text">
            <span className="banner-icon">⚠️</span>
            <span>
              <strong>Device Worn Upside Down:</strong> Lead I polarity is physically inverted.
            </span>
          </div>
          <button
            type="button"
            className="btn-flip-waveform"
            onClick={() => setInvertPolarity((p) => !p)}
          >
            {invertPolarity ? '✓ Polarity Corrected' : 'Invert Polarity'}
          </button>
        </div>
      )}

      <div className="ecg-canvas-wrapper">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: `${CANVAS_HEIGHT_CSS}px`, display: 'block' }}
          className="ecg-canvas"
        />
      </div>
    </div>
  );
};
