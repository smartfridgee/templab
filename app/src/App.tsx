import { useEffect, useState, useCallback, useRef } from 'react';
import {
  BridgeDeviceInfo,
  BridgeMessage,
  DeviceInfo,
  DeviceState,
  DiscoveredDevice,
  LogEntry,
  LogLevel,
  Vitals,
} from './types/telemetry';
import { bridgeClient } from './services/bridgeClient';
import { ecgBuffer } from './services/ecgBuffer';
import { ecgSimulator } from './services/ecgSimulator';
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

const initialVitals: Vitals = {
  heartRate: null,
  rrIntervals: [],
  skinTemperature: null,
  respirationRate: null,
  batteryLevel: null,
  steps: null,
  signalQuality: null,
  wearState: null,
};

function App() {
  const [bridgeOnline, setBridgeOnline] = useState<boolean>(bridgeClient.isOnline);
  const [deviceState, setDeviceState] = useState<DeviceState>('idle');
  const [device, setDevice] = useState<BridgeDeviceInfo | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredDevice[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  const [vitals, setVitals] = useState<Vitals>(initialVitals);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const isDemoRef = useRef(isDemoMode);
  isDemoRef.current = isDemoMode;

  const appendLog = useCallback((level: LogLevel, message: string) => {
    const entry: LogEntry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type: level,
      message,
    };
    setLogs((prev) => [entry, ...prev.slice(0, 99)]);
  }, []);

  const handleMessage = useCallback(
    (msg: BridgeMessage) => {
      switch (msg.type) {
        case 'status': {
          setDeviceState(msg.state);
          setDevice(msg.device);
          if (msg.state === 'connected') {
            ecgBuffer.reset();
            setLastUpdated(Date.now());
          } else if (msg.state === 'idle') {
            setVitals(initialVitals);
          }
          break;
        }
        case 'devices': {
          setDiscovered(msg.devices);
          if (msg.devices.length > 0) {
            setSelectedAddress((prev) =>
              msg.devices.some((d) => d.address === prev) ? prev : msg.devices[0].address
            );
          }
          break;
        }
        case 'ecg': {
          // Push directly to ring buffer — never through React state!
          ecgBuffer.push(msg.v, msg.t, msg.fs);
          break;
        }
        case 'heart_rate':
          setVitals((prev) => ({ ...prev, heartRate: msg.value }));
          setLastUpdated(Date.now());
          break;
        case 'rr':
          setVitals((prev) => ({
            ...prev,
            rrIntervals: [...prev.rrIntervals.slice(-19), msg.value],
          }));
          setLastUpdated(Date.now());
          break;
        case 'skin_temperature':
          setVitals((prev) => ({ ...prev, skinTemperature: msg.value }));
          setLastUpdated(Date.now());
          break;
        case 'respiration_rate':
          setVitals((prev) => ({ ...prev, respirationRate: msg.value }));
          setLastUpdated(Date.now());
          break;
        case 'battery':
          setVitals((prev) => ({ ...prev, batteryLevel: msg.value }));
          setLastUpdated(Date.now());
          break;
        case 'steps':
          setVitals((prev) => ({ ...prev, steps: msg.value }));
          setLastUpdated(Date.now());
          break;
        case 'signal_quality':
          setVitals((prev) => ({ ...prev, signalQuality: msg.value }));
          break;
        case 'wear_state':
          setVitals((prev) => ({ ...prev, wearState: msg.value }));
          setLastUpdated(Date.now());
          break;
        case 'log':
          appendLog(msg.level, msg.message);
          break;
      }
    },
    [appendLog]
  );

  // Connect WebSocket client to local Python bridge
  useEffect(() => {
    bridgeClient.start();
    const offConn = bridgeClient.onConnection((online) => {
      setBridgeOnline(online);
      if (!online && !isDemoRef.current) {
        setDeviceState('idle');
        setDevice(null);
      }
    });
    const offMsg = bridgeClient.onMessage((msg) => {
      if (!isDemoRef.current) {
        handleMessage(msg);
      }
    });
    return () => {
      offConn();
      offMsg();
      bridgeClient.stop();
      ecgSimulator.stop();
    };
  }, [handleMessage]);

  const handleScan = () => {
    if (isDemoMode) {
      ecgSimulator.stop();
      setIsDemoMode(false);
    }
    bridgeClient.send({ type: 'scan' });
  };

  const handleConnect = (address?: string) => {
    const target = address || selectedAddress;
    if (!target) return;
    if (isDemoMode) {
      ecgSimulator.stop();
      setIsDemoMode(false);
    }
    ecgBuffer.reset();
    setVitals(initialVitals);
    bridgeClient.send({ type: 'connect', address: target });
  };

  const handleDisconnect = () => {
    if (isDemoMode) {
      ecgSimulator.stop();
      setIsDemoMode(false);
      ecgBuffer.reset();
      setVitals(initialVitals);
      setDeviceState('idle');
      setDevice(null);
      appendLog('info', 'Demo simulator stopped.');
    } else {
      bridgeClient.send({ type: 'disconnect' });
      ecgBuffer.reset();
      setVitals(initialVitals);
    }
  };

  const handleToggleDemo = () => {
    if (isDemoMode) {
      ecgSimulator.stop();
      setIsDemoMode(false);
      ecgBuffer.reset();
      setVitals(initialVitals);
      setDeviceState('idle');
      setDevice(null);
      appendLog('info', 'Demo mode disabled.');
    } else {
      if (deviceState === 'connected') {
        bridgeClient.send({ type: 'disconnect' });
      }
      ecgBuffer.reset();
      setVitals(initialVitals);
      setIsDemoMode(true);
      ecgSimulator.start(handleMessage);
    }
  };

  const isConnected = deviceState === 'connected';
  const isBusy = deviceState === 'scanning' || deviceState === 'connecting';
  const isUpsideDown = vitals.wearState === 'upside_down';
  const sensorContact =
    vitals.wearState === 'proper' || vitals.wearState === 'upside_down'
      ? true
      : vitals.wearState === 'detached' || vitals.wearState === 'loose'
      ? false
      : isConnected
      ? true
      : null;

  const deviceInfoForCard: DeviceInfo = {
    manufacturer: device?.manufacturer ?? null,
    modelNumber: device?.name ?? null,
    serialNumber: device?.serialNumber ?? null,
    firmwareRevision: device?.firmwareRevision ?? null,
    hardwareRevision: device?.hardwareRevision ?? null,
  };

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
            <p className="brand-subtitle">Official Aidlab SDK Telemetry • 250 Hz ECG</p>
          </div>
        </div>

        <div className="header-status-group">
          <div className="connection-indicator">
            <span
              className={`status-dot ${
                isConnected ? 'online' : isBusy ? 'connecting' : 'offline'
              }`}
            />
            <span className="status-label">
              {isConnected
                ? isDemoMode
                  ? 'Simulator Active'
                  : `${device?.name || 'Aidmed One'} Connected`
                : deviceState === 'scanning'
                ? 'Scanning BLE...'
                : deviceState === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
            </span>
          </div>

          <div className="mode-toggle">
            <label className="toggle-label" title="Toggle synthetic 250 Hz ECG telemetry">
              <input
                type="checkbox"
                checked={isDemoMode}
                onChange={handleToggleDemo}
                disabled={isBusy}
              />
              <span className="toggle-slider" />
              <span className="toggle-text">Demo Mode</span>
            </label>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main">
        <TauriEnvironmentBanner bridgeOnline={bridgeOnline} isDemoMode={isDemoMode} />

        {/* Connection Control Bar */}
        <section className="controls-card">
          <div className="controls-left">
            {!isConnected ? (
              <>
                <button
                  type="button"
                  className="btn-connect"
                  onClick={handleScan}
                  disabled={!bridgeOnline || isBusy}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z" />
                  </svg>
                  {deviceState === 'scanning' ? 'Scanning (6s)...' : 'Scan for Aidlab / Aidmed'}
                </button>

                {discovered.length > 0 && (
                  <div className="device-picker-group">
                    <select
                      className="device-select"
                      value={selectedAddress}
                      onChange={(e) => setSelectedAddress(e.target.value)}
                      disabled={isBusy}
                    >
                      {discovered.map((d) => (
                        <option key={d.address} value={d.address}>
                          {d.name} ({d.address.slice(0, 8)}…{d.rssi !== null ? ` • ${d.rssi} dBm` : ''})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-primary-small"
                      onClick={() => handleConnect(selectedAddress)}
                      disabled={!bridgeOnline || isBusy || !selectedAddress}
                    >
                      {deviceState === 'connecting' ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button type="button" className="btn-disconnect" onClick={handleDisconnect}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Disconnect Device
              </button>
            )}

            {isDemoMode && (
              <button
                type="button"
                className="btn-secondary-small"
                onClick={() => ecgSimulator.toggleUpsideDown()}
                title="Toggle simulated chest strap orientation (normal vs upside-down)"
              >
                {isUpsideDown ? '🔄 Orientation: Upside-Down' : '🔄 Orientation: Upright'}
              </button>
            )}
          </div>

          <div className="controls-right">
            {device?.name && (
              <div className="device-tag">
                <span className="device-tag-label">Device:</span>
                <span className="device-tag-name">{device.name}</span>
              </div>
            )}
            {device?.firmwareRevision && (
              <div className="device-tag">
                <span className="device-tag-label">FW:</span>
                <span className="device-tag-name">{device.firmwareRevision}</span>
              </div>
            )}
            {lastUpdated && (
              <div className="device-tag">
                <span className="device-tag-label">Updated:</span>
                <span className="device-tag-name">{new Date(lastUpdated).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        </section>

        {/* Live ECG Waveform Monitor */}
        <section className="section-ecg">
          <ECGMonitor
            heartRate={vitals.heartRate}
            signalQuality={vitals.signalQuality}
            wearState={vitals.wearState}
            isConnected={isConnected}
          />
        </section>

        {/* Primary Parameters Grid */}
        <section className="section-metrics-grid">
          <HeartRateCard
            heartRate={vitals.heartRate}
            sensorContact={sensorContact}
            wearState={vitals.wearState}
            isUpsideDown={isUpsideDown}
            rrIntervals={vitals.rrIntervals}
            isConnected={isConnected}
          />

          <TemperatureCard
            temperature={vitals.skinTemperature}
            isConnected={isConnected}
          />

          <BatteryCard
            batteryLevel={vitals.batteryLevel}
            isConnected={isConnected}
          />

          <RespirationCard
            respirationRate={vitals.respirationRate}
            steps={vitals.steps}
            activity={isConnected ? 'Streaming' : 'Standby'}
            isConnected={isConnected}
          />
        </section>

        {/* Hardware & Diagnostic Details */}
        <section className="section-info">
          <DeviceInfoCard
            deviceInfo={deviceInfoForCard}
            deviceName={device?.name ?? null}
            deviceId={device?.address ?? null}
            wearState={vitals.wearState}
            isUpsideDown={isUpsideDown}
            isConnected={isConnected}
          />
        </section>

        {/* Event / Bluetooth Logs */}
        <section className="section-logs">
          <BluetoothLogViewer logs={logs} onClear={() => setLogs([])} />
        </section>
      </main>

      <footer className="app-footer">
        <p>Aidmed One Monitor • Powered by Official Aidlab Native SDK Bridge &amp; Tauri V2</p>
      </footer>
    </div>
  );
}

export default App;
