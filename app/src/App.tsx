import { useEffect, useState, useCallback } from 'react';
import { AidmedParameters, LogEntry } from './types/bluetooth';
import { aidmedBleService } from './services/aidmedBleService';
import { aidmedSimulator } from './services/aidmedSimulator';
import { ECGMonitor } from './components/ECGMonitor';
import {
  HeartRateCard,
  TemperatureCard,
  BatteryCard,
  RespirationCard,
  DeviceInfoCard,
} from './components/ParameterCard';
import { TauriEnvironmentBanner } from './components/TauriEnvironmentBanner';
import { BluetoothLogViewer } from './components/BluetoothLogViewer';
import './App.css';

const initialParameters: AidmedParameters = {
  status: 'disconnected',
  deviceName: null,
  deviceId: null,
  errorMessage: null,
  lastUpdated: null,
  batteryLevel: null,
  heartRate: null,
  sensorContact: null,
  wearState: null,
  isUpsideDown: false,
  rrIntervals: [],
  skinTemperature: null,
  respirationRate: null,
  steps: null,
  activity: null,
  ecgSamples: [],
  deviceInfo: {
    manufacturer: null,
    modelNumber: null,
    serialNumber: null,
    firmwareRevision: null,
    hardwareRevision: null,
  },
};

function App() {
  const [params, setParams] = useState<AidmedParameters>(initialParameters);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [showAllDevices, setShowAllDevices] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const isBluetoothSupported = aidmedBleService.isSupported();

  const addLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => [entry, ...prev.slice(0, 99)]);
  }, []);

  const handleDataUpdate = useCallback((partial: Partial<AidmedParameters>) => {
    setParams((prev) => {
      // Filter out undefined keys so partial packets don't clear existing parameter values
      const cleanPartial: Partial<AidmedParameters> = {};
      for (const [key, value] of Object.entries(partial)) {
        if (value !== undefined) {
          (cleanPartial as any)[key] = value;
        }
      }

      const mergedDeviceInfo = cleanPartial.deviceInfo
        ? { ...prev.deviceInfo, ...cleanPartial.deviceInfo }
        : prev.deviceInfo;

      return {
        ...prev,
        ...cleanPartial,
        deviceInfo: mergedDeviceInfo,
        lastUpdated: cleanPartial.lastUpdated ?? Date.now(),
      };
    });
  }, []);

  // Setup callbacks on BleService
  useEffect(() => {
    aidmedBleService.setCallbacks(
      handleDataUpdate,
      addLog,
      () => {
        setParams((prev) => ({
          ...initialParameters,
          status: 'disconnected',
          logs: prev.status === 'connected' ? [] : prev.deviceInfo ? [] : [],
        }));
      }
    );
  }, [handleDataUpdate, addLog]);

  const handleConnectBle = async () => {
    // If demo mode is running, stop it first
    if (isDemoMode) {
      aidmedSimulator.stop();
      setIsDemoMode(false);
    }

    setParams((prev) => ({
      ...prev,
      status: 'connecting',
      errorMessage: null,
    }));

    try {
      await aidmedBleService.connect(showAllDevices);
    } catch (err: any) {
      const msg = err.message || 'Failed to connect to device.';
      setParams((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: msg,
      }));
    }
  };

  const handleDisconnect = () => {
    if (isDemoMode) {
      aidmedSimulator.stop();
      setIsDemoMode(false);
      setParams(initialParameters);
      addLog({
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        type: 'info',
        message: 'Demo Simulator stopped.',
      });
    } else {
      aidmedBleService.disconnect();
      setParams(initialParameters);
    }
  };

  const handleToggleDemo = () => {
    if (isDemoMode) {
      aidmedSimulator.stop();
      setIsDemoMode(false);
      setParams(initialParameters);
      addLog({
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        type: 'info',
        message: 'Demo Simulator disabled.',
      });
    } else {
      // Disconnect BLE if active
      if (aidmedBleService.isConnected()) {
        aidmedBleService.disconnect();
      }
      setIsDemoMode(true);
      addLog({
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        type: 'success',
        message: 'Demo Simulator started with synthetic Aidmed One signals.',
      });
      aidmedSimulator.start(handleDataUpdate);
    }
  };

  const isConnected = params.status === 'connected';
  const isConnecting = params.status === 'connecting';

  return (
    <div className="aidmed-app">
      {/* App Header */}
      <header className="app-header">
        <div className="brand-group">
          <div className="brand-logo">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <div>
            <h1 className="brand-title">Aidmed One Monitor</h1>
            <p className="brand-subtitle">Bluetooth Biosignal Telemetry • Tauri V2</p>
          </div>
        </div>

        <div className="header-status-group">
          <div className="connection-indicator">
            <span
              className={`status-dot ${
                isConnected ? 'online' : isConnecting ? 'connecting' : 'offline'
              }`}
            />
            <span className="status-label">
              {isConnected
                ? isDemoMode
                  ? 'Simulator Connected'
                  : 'Aidmed One Connected'
                : isConnecting
                ? 'Pairing / Connecting...'
                : 'Disconnected'}
            </span>
          </div>

          <div className="mode-toggle">
            <label className="toggle-label" title="Toggle synthetic telemetry for testing">
              <input
                type="checkbox"
                checked={isDemoMode}
                onChange={handleToggleDemo}
                disabled={isConnecting}
              />
              <span className="toggle-slider" />
              <span className="toggle-text">Demo Mode</span>
            </label>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main">
        {/* Environment Alert Banner */}
        <TauriEnvironmentBanner isBluetoothSupported={isBluetoothSupported} />

        {/* Connection Control Bar */}
        <section className="controls-card">
          <div className="controls-left">
            {!isConnected ? (
              <button
                type="button"
                className="btn-connect"
                onClick={handleConnectBle}
                disabled={isConnecting || !isBluetoothSupported}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z" />
                </svg>
                {isConnecting ? 'Connecting to Aidmed One...' : 'Connect Aidmed One'}
              </button>
            ) : (
              <button type="button" className="btn-disconnect" onClick={handleDisconnect}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Disconnect Device
              </button>
            )}

            <label className="checkbox-control" title="Show all BLE devices in Chrome chooser">
              <input
                type="checkbox"
                checked={showAllDevices}
                onChange={(e) => setShowAllDevices(e.target.checked)}
                disabled={isConnected || isConnecting}
              />
              <span>Show all nearby Bluetooth devices in picker</span>
            </label>

            {isDemoMode && (
              <button
                type="button"
                className="btn-secondary-small"
                onClick={() => aidmedSimulator.toggleUpsideDown()}
                title="Toggle simulated device orientation (normal vs upside-down)"
              >
                {params.isUpsideDown ? '🔄 Simulate: Upright' : '🔄 Simulate: Upside-Down'}
              </button>
            )}
          </div>

          <div className="controls-right">
            {params.deviceName && (
              <div className="device-tag">
                <span className="device-tag-label">Device:</span>
                <span className="device-tag-name">{params.deviceName}</span>
              </div>
            )}
            {params.isUpsideDown && (
              <div className="device-tag upside-down-tag">
                <span className="device-tag-label">Orientation:</span>
                <span className="device-tag-name warn-text">⚠️ Upside Down</span>
              </div>
            )}
            {params.lastUpdated && (
              <div className="device-tag">
                <span className="device-tag-label">Updated:</span>
                <span className="device-tag-name">
                  {new Date(params.lastUpdated).toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Error Notification */}
        {params.errorMessage && (
          <div className="error-banner">
            <span className="error-icon">⚠️</span>
            <span className="error-text">{params.errorMessage}</span>
          </div>
        )}

        {/* Live ECG Waveform Monitor */}
        <section className="section-ecg">
          <ECGMonitor
            samples={params.ecgSamples}
            heartRate={params.heartRate}
            sensorContact={params.sensorContact}
            wearState={params.wearState}
            isUpsideDown={params.isUpsideDown}
            isConnected={isConnected}
            onActivateStream={() => {
              if (!isDemoMode) {
                aidmedBleService.activateStreaming();
              }
            }}
          />
        </section>

        {/* Primary Parameters Grid */}
        <section className="section-metrics-grid">
          <HeartRateCard
            heartRate={params.heartRate}
            sensorContact={params.sensorContact}
            wearState={params.wearState}
            isUpsideDown={params.isUpsideDown}
            rrIntervals={params.rrIntervals}
            isConnected={isConnected}
          />

          <TemperatureCard
            temperature={params.skinTemperature}
            isConnected={isConnected}
          />

          <BatteryCard
            batteryLevel={params.batteryLevel}
            isConnected={isConnected}
          />

          <RespirationCard
            respirationRate={params.respirationRate}
            steps={params.steps}
            activity={params.activity}
            isConnected={isConnected}
          />
        </section>

        {/* Hardware & Diagnostic Details */}
        <section className="section-info">
          <DeviceInfoCard
            deviceInfo={params.deviceInfo}
            deviceName={params.deviceName}
            deviceId={params.deviceId}
            wearState={params.wearState}
            isUpsideDown={params.isUpsideDown}
            isConnected={isConnected}
          />
        </section>

        {/* Event / Bluetooth Logs */}
        <section className="section-logs">
          <BluetoothLogViewer logs={logs} onClear={() => setLogs([])} />
        </section>
      </main>

      {/* App Footer */}
      <footer className="app-footer">
        <p>Aidmed One BLE Reader • Compatible with Chrome Web Bluetooth & Tauri V2 Desktop</p>
      </footer>
    </div>
  );
}

export default App;
