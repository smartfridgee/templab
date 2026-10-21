// Web Bluetooth API Type Definitions and Aidmed One Data Models

export interface BluetoothCharacteristicProperties {
  broadcast: boolean;
  read: boolean;
  writeWithoutResponse: boolean;
  write: boolean;
  notify: boolean;
  indicate: boolean;
  authenticatedSignedWrites: boolean;
  reliableWrite: boolean;
  writableAuxiliaries: boolean;
}

export interface BluetoothRemoteGATTDescriptor {
  characteristic: BluetoothRemoteGATTCharacteristic;
  uuid: string;
  value?: DataView;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
}

export interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  service: BluetoothRemoteGATTService;
  uuid: string;
  properties: BluetoothCharacteristicProperties;
  value?: DataView;
  getDescriptor(descriptor: string | number): Promise<BluetoothRemoteGATTDescriptor>;
  getDescriptors(descriptor?: string | number): Promise<BluetoothRemoteGATTDescriptor[]>;
  readValue(): Promise<DataView>;
  writeValue(value: any): Promise<void>;
  writeValueWithResponse(value: any): Promise<void>;
  writeValueWithoutResponse(value: any): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  addEventListener(
    type: 'characteristicvaluechanged',
    listener: (this: BluetoothRemoteGATTCharacteristic, ev: Event) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: 'characteristicvaluechanged',
    listener: (this: BluetoothRemoteGATTCharacteristic, ev: Event) => any,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface BluetoothRemoteGATTService {
  device: BluetoothDevice;
  uuid: string;
  isPrimary: boolean;
  getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(characteristic?: string | number): Promise<BluetoothRemoteGATTCharacteristic[]>;
  getIncludedService(service: string | number): Promise<BluetoothRemoteGATTService>;
  getIncludedServices(service?: string | number): Promise<BluetoothRemoteGATTService[]>;
}

export interface BluetoothRemoteGATTServer {
  device: BluetoothDevice;
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(service?: string | number): Promise<BluetoothRemoteGATTService[]>;
}

export interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
  watchingAdvertisements: boolean;
  watchAdvertisements(): Promise<void>;
  unwatchAdvertisements(): void;
  addEventListener(
    type: 'gattserverdisconnected',
    listener: (this: BluetoothDevice, ev: Event) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: 'gattserverdisconnected',
    listener: (this: BluetoothDevice, ev: Event) => any,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface RequestDeviceOptions {
  filters?: Array<{
    name?: string;
    namePrefix?: string;
    services?: Array<string | number>;
  }>;
  optionalServices?: Array<string | number>;
  acceptAllDevices?: boolean;
}

export interface Bluetooth {
  getAvailability(): Promise<boolean>;
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
}

declare global {
  interface Navigator {
    bluetooth?: Bluetooth;
  }
}

export type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';

export type WearState = 'proper' | 'upside_down' | 'loose' | 'detached' | 'unknown' | 'unsettled';

export interface DeviceInfo {
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  firmwareRevision: string | null;
  hardwareRevision: string | null;
}

export interface AidmedParameters {
  // Connection details
  status: ConnectionStatus;
  deviceName: string | null;
  deviceId: string | null;
  errorMessage: string | null;
  lastUpdated: number | null;

  // Basic telemetry
  batteryLevel: number | null; // % (0-100)
  heartRate: number | null; // BPM
  sensorContact: boolean | null; // true if chest leads contact detected
  wearState: WearState | null; // Placement classification (proper, upside_down, loose, detached)
  isUpsideDown: boolean; // true if device is worn/placed upside down
  rrIntervals: number[]; // ms
  skinTemperature: number | null; // °C
  respirationRate: number | null; // breaths/min or live amplitude
  steps: number | null; // step count
  activity: string | null; // e.g., 'Resting', 'Walking', 'Running'
  
  // Real-time signal stream (ECG)
  ecgSamples: number[]; // Recent mV / raw samples for visualizer

  // Hardware metadata
  deviceInfo: DeviceInfo;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}
