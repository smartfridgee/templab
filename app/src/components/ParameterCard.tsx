import React from 'react';
import { DeviceInfo, WearState } from '../types/telemetry';

interface HeartRateCardProps {
  heartRate?: number | null;
  sensorContact?: boolean | null;
  wearState?: WearState | null;
  isUpsideDown?: boolean;
  rrIntervals?: number[];
  isConnected: boolean;
}

export const HeartRateCard: React.FC<HeartRateCardProps> = ({
  heartRate,
  sensorContact,
  wearState,
  isUpsideDown = false,
  rrIntervals = [],
  isConnected,
}) => {
  const hasHR = typeof heartRate === 'number' && Number.isFinite(heartRate);
  const isHigh = hasHR && heartRate > 100;
  const isLow = hasHR && heartRate < 50;

  const contactLabel = isUpsideDown || wearState === 'upside_down'
    ? '⚠️ Upside Down'
    : wearState === 'loose'
    ? '⚠️ Loose Strap'
    : wearState === 'detached'
    ? 'No Contact (Detached)'
    : sensorContact
    ? 'Electrodes Attached'
    : 'No Contact';

  const contactClass = isUpsideDown || wearState === 'upside_down' || wearState === 'loose'
    ? 'warn'
    : sensorContact
    ? 'active'
    : 'inactive';

  return (
    <div className="param-card hr-card">
      <div className="card-header">
        <div className="card-title-group">
          <span className="card-icon hr-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </span>
          <span className="card-title">Heart Rate</span>
        </div>
        <span className={`status-pill ${contactClass}`}>
          {contactLabel}
        </span>
      </div>

      <div className="card-body">
        <div className="metric-large">
          <span className={`metric-value ${isHigh ? 'warn-high' : isLow ? 'warn-low' : ''}`}>
            {isConnected && hasHR ? heartRate : '--'}
          </span>
          <span className="metric-unit">BPM</span>
        </div>

        <div className="metric-details">
          <div className="detail-item">
            <span className="detail-label">Status</span>
            <span className="detail-val">
              {!hasHR
                ? 'Standby'
                : isHigh
                ? 'Tachycardia'
                : isLow
                ? 'Bradycardia'
                : 'Normal Sinus'}
            </span>
          </div>

          <div className="detail-item">
            <span className="detail-label">RR Interval</span>
            <span className="detail-val">
              {Array.isArray(rrIntervals) && rrIntervals.length > 0
                ? `${rrIntervals[rrIntervals.length - 1]} ms`
                : '--'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface TemperatureCardProps {
  temperature?: number | null;
  isConnected: boolean;
}

export const TemperatureCard: React.FC<TemperatureCardProps> = ({
  temperature,
  isConnected,
}) => {
  const hasTemp = typeof temperature === 'number' && Number.isFinite(temperature);
  const fahrenheit = hasTemp ? Math.round(((temperature * 9) / 5 + 32) * 10) / 10 : null;

  return (
    <div className="param-card temp-card">
      <div className="card-header">
        <div className="card-title-group">
          <span className="card-icon temp-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
            </svg>
          </span>
          <span className="card-title">Skin Temperature</span>
        </div>
        <span className="status-pill active">Continuous</span>
      </div>

      <div className="card-body">
        <div className="metric-large">
          <span className="metric-value">
            {isConnected && hasTemp ? temperature.toFixed(1) : '--'}
          </span>
          <span className="metric-unit">°C</span>
        </div>

        <div className="metric-details">
          <div className="detail-item">
            <span className="detail-label">Fahrenheit</span>
            <span className="detail-val">
              {isConnected && fahrenheit !== null ? `${fahrenheit.toFixed(1)}°F` : '--'}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Range</span>
            <span className="detail-val">Normothermia (36.0 - 37.5)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface BatteryCardProps {
  batteryLevel?: number | null;
  isConnected: boolean;
}

export const BatteryCard: React.FC<BatteryCardProps> = ({ batteryLevel, isConnected }) => {
  const hasBattery = typeof batteryLevel === 'number' && Number.isFinite(batteryLevel);
  const level = hasBattery ? batteryLevel : 0;
  const isLow = hasBattery && level <= 20;

  return (
    <div className="param-card battery-card">
      <div className="card-header">
        <div className="card-title-group">
          <span className={`card-icon battery-icon ${isLow ? 'low' : ''}`}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="7" width="16" height="10" rx="2" ry="2" />
              <line x1="22" y1="11" x2="22" y2="13" />
            </svg>
          </span>
          <span className="card-title">Battery Level</span>
        </div>
        <span className={`status-pill ${isLow ? 'warn' : 'active'}`}>
          {isConnected && hasBattery
            ? isLow
              ? 'Low Battery'
              : 'Optimal'
            : 'Disconnected'}
        </span>
      </div>

      <div className="card-body">
        <div className="metric-large">
          <span className="metric-value">
            {isConnected && hasBattery ? batteryLevel : '--'}
          </span>
          <span className="metric-unit">%</span>
        </div>

        <div className="battery-bar-container">
          <div
            className={`battery-bar-fill ${isLow ? 'low' : level < 50 ? 'mid' : 'good'}`}
            style={{ width: `${isConnected && hasBattery ? Math.min(100, Math.max(0, batteryLevel)) : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
};

interface RespirationCardProps {
  respirationRate?: number | null;
  steps?: number | null;
  activity?: string | null;
  isConnected: boolean;
}

export const RespirationCard: React.FC<RespirationCardProps> = ({
  respirationRate,
  steps,
  activity,
  isConnected,
}) => {
  const hasResp = typeof respirationRate === 'number' && Number.isFinite(respirationRate);
  const hasSteps = typeof steps === 'number' && Number.isFinite(steps);

  return (
    <div className="param-card resp-card">
      <div className="card-header">
        <div className="card-title-group">
          <span className="card-icon resp-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v18M3 12h18M6.5 6.5l11 11M6.5 17.5l11-11" />
            </svg>
          </span>
          <span className="card-title">Respiration & Motion</span>
        </div>
        <span className="status-pill active">{activity || 'Resting'}</span>
      </div>

      <div className="card-body">
        <div className="metric-split">
          <div>
            <div className="metric-large">
              <span className="metric-value">
                {isConnected && hasResp ? respirationRate : '--'}
              </span>
              <span className="metric-unit">Br/min</span>
            </div>
            <span className="sublabel">Respiration Rate</span>
          </div>

          <div>
            <div className="metric-large">
              <span className="metric-value">
                {isConnected && hasSteps ? steps.toLocaleString() : '--'}
              </span>
              <span className="metric-unit">Steps</span>
            </div>
            <span className="sublabel">Session Movement</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DeviceInfoCardProps {
  deviceInfo?: DeviceInfo | null;
  deviceName?: string | null;
  deviceId?: string | null;
  wearState?: WearState | null;
  isUpsideDown?: boolean;
  isConnected: boolean;
}

export const DeviceInfoCard: React.FC<DeviceInfoCardProps> = ({
  deviceInfo,
  deviceName,
  deviceId,
  wearState,
  isUpsideDown = false,
  isConnected,
}) => {
  const info = deviceInfo || {
    manufacturer: null,
    modelNumber: null,
    serialNumber: null,
    firmwareRevision: null,
    hardwareRevision: null,
  };

  return (
    <div className="param-card info-card">
      <div className="card-header">
        <div className="card-title-group">
          <span className="card-icon info-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
          </span>
          <span className="card-title">Aidmed One Hardware</span>
        </div>
        <span className={`status-pill ${isUpsideDown ? 'warn' : isConnected ? 'active' : 'inactive'}`}>
          {isUpsideDown ? '⚠️ Upside Down' : isConnected ? 'Paired via BLE' : 'Offline'}
        </span>
      </div>

      <div className="card-body">
        <div className="info-grid">
          <div className="info-item">
            <span className="info-key">Device Name:</span>
            <span className="info-val">{deviceName || 'Aidmed One'}</span>
          </div>
          <div className="info-item">
            <span className="info-key">Placement:</span>
            <span className={`info-val ${isUpsideDown ? 'warn-val' : ''}`}>
              {isUpsideDown
                ? '⚠️ Upside Down (Inverted)'
                : wearState === 'detached'
                ? 'Detached'
                : wearState === 'loose'
                ? 'Loose Contact'
                : 'Proper / Upright'}
            </span>
          </div>
          <div className="info-item">
            <span className="info-key">Manufacturer:</span>
            <span className="info-val">{info.manufacturer || 'Aidmed'}</span>
          </div>
          <div className="info-item">
            <span className="info-key">Model / Hardware:</span>
            <span className="info-val">
              {info.modelNumber || 'Aidmed One'} {info.hardwareRevision ? `(${info.hardwareRevision})` : ''}
            </span>
          </div>
          <div className="info-item">
            <span className="info-key">Firmware Version:</span>
            <span className="info-val">{info.firmwareRevision || 'v3.8.x+'}</span>
          </div>
          <div className="info-item">
            <span className="info-key">Serial Number:</span>
            <span className="info-val">{info.serialNumber || (deviceId ? deviceId.substring(0, 14) : 'N/A')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
