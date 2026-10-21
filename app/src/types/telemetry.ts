// Data models shared by the UI, the bridge client and the demo simulator.
//
// BLE decoding happens in the Python bridge (bridge/aidlab_bridge.py) through
// the official Aidlab SDK. The UI only gets decoded values over a WebSocket.

export type WearState = 'proper' | 'upside_down' | 'loose' | 'detached' | 'unknown' | 'unsettled';

/** Connection state reported by the bridge. */
export type DeviceState = 'idle' | 'scanning' | 'connecting' | 'connected';

export interface DeviceInfo {
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  firmwareRevision: string | null;
  hardwareRevision: string | null;
}

export interface BridgeDeviceInfo {
  address: string;
  name: string | null;
  firmwareRevision: string | null;
  hardwareRevision: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
}

export interface DiscoveredDevice {
  address: string;
  name: string;
  rssi: number | null;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: LogLevel;
  message: string;
}

/** Low-rate vitals. ECG samples are NOT stored here (see services/ecgBuffer.ts). */
export interface Vitals {
  heartRate: number | null; // BPM
  rrIntervals: number[]; // ms, most recent last
  skinTemperature: number | null; // °C
  respirationRate: number | null; // breaths/min
  batteryLevel: number | null; // %
  steps: number | null;
  signalQuality: number | null; // 0..100
  wearState: WearState | null;
}

/** Messages sent by the bridge (and the demo simulator, which uses the same format). */
export type BridgeMessage =
  | { type: 'status'; state: DeviceState; device: BridgeDeviceInfo | null }
  | { type: 'devices'; devices: DiscoveredDevice[] }
  | { type: 'ecg'; fs: number; t: number[]; v: number[] } // t: unix ms, v: millivolts
  | { type: 'heart_rate'; value: number }
  | { type: 'rr'; value: number }
  | { type: 'skin_temperature'; value: number }
  | { type: 'respiration_rate'; value: number }
  | { type: 'battery'; value: number }
  | { type: 'steps'; value: number }
  | { type: 'signal_quality'; value: number }
  | { type: 'wear_state'; value: WearState }
  | { type: 'log'; level: LogLevel; message: string };

/** Commands sent to the bridge. */
export type BridgeCommand =
  | { type: 'scan' }
  | { type: 'connect'; address: string }
  | { type: 'disconnect' };
