import {
  AidmedParameters,
  BluetoothDevice,
  BluetoothRemoteGATTCharacteristic,
  BluetoothRemoteGATTServer,
  DeviceInfo,
  LogEntry,
} from '../types/bluetooth';
import { AidmedPacketParser } from './aidmedPacketParser';

// Standard Bluetooth SIG Service and Characteristic UUIDs (Short & Full 128-bit)
export const BLE_SERVICES = {
  HEART_RATE: '0000180d-0000-1000-8000-00805f9b34fb',
  BATTERY: '0000180f-0000-1000-8000-00805f9b34fb',
  DEVICE_INFO: '0000180a-0000-1000-8000-00805f9b34fb',
  HEALTH_THERMOMETER: '00001809-0000-1000-8000-00805f9b34fb',
  CURRENT_TIME: '00001805-0000-1000-8000-00805f9b34fb',
  // Aidmed / Aidlab proprietary services
  AIDMED_USER: '44366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_MOTION: '60366e80-cf3a-11e1-9ab4-0002a5d5c51b',
};

export const BLE_CHARACTERISTICS = {
  // Standard characteristics
  HEART_RATE_MEASUREMENT: '00002a37-0000-1000-8000-00805f9b34fb',
  BATTERY_LEVEL: '00002a19-0000-1000-8000-00805f9b34fb',
  TEMP_MEASUREMENT: '00002a1c-0000-1000-8000-00805f9b34fb',
  MANUFACTURER_NAME: '00002a29-0000-1000-8000-00805f9b34fb',
  MODEL_NUMBER: '00002a24-0000-1000-8000-00805f9b34fb',
  SERIAL_NUMBER: '00002a25-0000-1000-8000-00805f9b34fb',
  FIRMWARE_REVISION: '00002a26-0000-1000-8000-00805f9b34fb',
  HARDWARE_REVISION: '00002a27-0000-1000-8000-00805f9b34fb',

  // Aidmed One / Aidlab user service characteristics
  AIDMED_CMD: '51366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_TEMPERATURE: '45366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_ECG: '46366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_BATTERY: '47366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_RESPIRATION: '48366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_MOTION: '49366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_SOUND_VOLUME: '52366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_PRESSURE: '53366e80-cf3a-11e1-9ab4-0002a5d5c51b',

  // Aidmed One / Aidlab motion service characteristics
  AIDMED_ACTIVITY: '61366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_STEPS: '62366e80-cf3a-11e1-9ab4-0002a5d5c51b',
  AIDMED_ORIENTATION: '63366e80-cf3a-11e1-9ab4-0002a5d5c51b',
};

export class AidmedBleService {
  private activeDevice: BluetoothDevice | null = null;
  private activeServer: BluetoothRemoteGATTServer | null = null;
  private commandCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private subscribedCharacteristics: BluetoothRemoteGATTCharacteristic[] = [];
  private packetParser = new AidmedPacketParser();

  private onDataCallback: ((params: Partial<AidmedParameters>) => void) | null = null;
  private onLogCallback: ((entry: LogEntry) => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;

  constructor() {}

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
  }

  public isConnected(): boolean {
    return Boolean(this.activeServer && this.activeServer.connected);
  }

  public getConnectedDevice(): BluetoothDevice | null {
    return this.activeDevice;
  }

  public setCallbacks(
    onData: (params: Partial<AidmedParameters>) => void,
    onLog: (entry: LogEntry) => void,
    onDisconnect: () => void
  ) {
    this.onDataCallback = onData;
    this.onLogCallback = onLog;
    this.onDisconnectCallback = onDisconnect;
  }

  private log(type: 'info' | 'success' | 'warn' | 'error', message: string) {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
    };
    if (this.onLogCallback) {
      this.onLogCallback(entry);
    }
  }

  /**
   * Request Bluetooth device and establish connection
   */
  public async connect(showAllDevices: boolean = false): Promise<void> {
    if (!this.isSupported()) {
      throw new Error(
        'Web Bluetooth API is not available. Please use Google Chrome or a Chromium-based browser with Bluetooth support.'
      );
    }

    this.packetParser.reset();
    this.log('info', 'Opening Bluetooth device chooser in Chrome...');

    // All services we want to query
    const optionalServices = [
      BLE_SERVICES.BATTERY,
      BLE_SERVICES.HEART_RATE,
      BLE_SERVICES.DEVICE_INFO,
      BLE_SERVICES.HEALTH_THERMOMETER,
      BLE_SERVICES.CURRENT_TIME,
      BLE_SERVICES.AIDMED_USER,
      BLE_SERVICES.AIDMED_MOTION,
    ];

    let device: BluetoothDevice;

    try {
      if (showAllDevices) {
        device = await navigator.bluetooth!.requestDevice({
          acceptAllDevices: true,
          optionalServices,
        });
      } else {
        device = await navigator.bluetooth!.requestDevice({
          filters: [
            { namePrefix: 'Aidmed' },
            { namePrefix: 'Aidlab' },
            { namePrefix: 'Aid' },
            { services: [BLE_SERVICES.AIDMED_USER] },
            { services: [BLE_SERVICES.HEART_RATE] },
          ],
          optionalServices,
        });
      }
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        this.log('warn', 'Bluetooth device selection cancelled by user.');
        throw new Error('Device selection cancelled.');
      }
      this.log('error', `Bluetooth request failed: ${err.message || err}`);
      throw err;
    }

    this.activeDevice = device;
    const deviceName = device.name || 'Aidmed One';
    this.log('success', `Selected device: "${deviceName}" (ID: ${device.id})`);

    // Listen to disconnection
    device.addEventListener('gattserverdisconnected', this.handleGattDisconnected);

    // Connect to GATT
    this.log('info', `Connecting to GATT server on "${deviceName}"...`);
    const server = await device.gatt!.connect();
    this.activeServer = server;
    this.log('success', 'GATT Server connected!');

    if (this.onDataCallback) {
      this.onDataCallback({
        status: 'connected',
        deviceName,
        deviceId: device.id,
        lastUpdated: Date.now(),
      });
    }

    // Discover & read services
    await this.discoverAllServices(server);
  }

  private handleGattDisconnected = () => {
    this.log('warn', `Device disconnected.`);
    this.cleanup();
    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
  };

  /**
   * Disconnect active GATT connection
   */
  public disconnect(): void {
    if (this.activeDevice && this.activeDevice.gatt && this.activeDevice.gatt.connected) {
      this.log('info', `Disconnecting from ${this.activeDevice.name || 'device'}...`);
      this.activeDevice.gatt.disconnect();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.activeDevice) {
      this.activeDevice.removeEventListener('gattserverdisconnected', this.handleGattDisconnected);
    }
    this.activeDevice = null;
    this.activeServer = null;
    this.commandCharacteristic = null;
    this.subscribedCharacteristics = [];
    this.packetParser.reset();
  }

  /**
   * Discover and setup all known services
   */
  private async discoverAllServices(server: BluetoothRemoteGATTServer): Promise<void> {
    // 1. Device Information
    await this.setupDeviceInfoService(server);

    // 2. Battery Service
    await this.setupBatteryService(server);

    // 3. Heart Rate Service
    await this.setupHeartRateService(server);

    // 4. Health Thermometer Service
    await this.setupHealthThermometerService(server);

    // 5. Aidmed User Service (Custom commands, ECG, Respiration, Temp)
    await this.setupAidmedUserService(server);

    // 6. Aidmed Motion Service (Steps, Activity, Orientation)
    await this.setupAidmedMotionService(server);
  }

  /**
   * 1. Device Information Service (0x180A)
   */
  private async setupDeviceInfoService(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const service = await server.getPrimaryService(BLE_SERVICES.DEVICE_INFO);
      this.log('info', 'Found Device Information Service (0x180A)');
      const info: DeviceInfo = {
        manufacturer: null,
        modelNumber: null,
        serialNumber: null,
        firmwareRevision: null,
        hardwareRevision: null,
      };

      const readString = async (uuid: string): Promise<string | null> => {
        try {
          const char = await service.getCharacteristic(uuid);
          const val = await char.readValue();
          return new TextDecoder().decode(val).trim();
        } catch {
          return null;
        }
      };

      info.manufacturer = await readString(BLE_CHARACTERISTICS.MANUFACTURER_NAME);
      info.modelNumber = await readString(BLE_CHARACTERISTICS.MODEL_NUMBER);
      info.serialNumber = await readString(BLE_CHARACTERISTICS.SERIAL_NUMBER);
      info.firmwareRevision = await readString(BLE_CHARACTERISTICS.FIRMWARE_REVISION);
      info.hardwareRevision = await readString(BLE_CHARACTERISTICS.HARDWARE_REVISION);

      this.log(
        'success',
        `Device Info: ${info.modelNumber || 'Aidmed One'} | FW: ${info.firmwareRevision || 'N/A'} | Mfr: ${info.manufacturer || 'Aidmed'}`
      );

      if (this.onDataCallback) {
        this.onDataCallback({ deviceInfo: info, lastUpdated: Date.now() });
      }
    } catch {
      this.log('info', 'Device Information service not available on this device.');
    }
  }

  /**
   * 2. Battery Service (0x180F)
   */
  private async setupBatteryService(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const service = await server.getPrimaryService(BLE_SERVICES.BATTERY);
      this.log('info', 'Found Battery Service (0x180F)');
      const char = await service.getCharacteristic(BLE_CHARACTERISTICS.BATTERY_LEVEL);

      // Read current level
      try {
        const val = await char.readValue();
        const level = val.getUint8(0);
        this.log('success', `Battery Level: ${level}%`);
        if (this.onDataCallback) {
          this.onDataCallback({ batteryLevel: level, lastUpdated: Date.now() });
        }
      } catch {
        this.log('warn', 'Could not read initial battery value.');
      }

      // Subscribe to changes if supported
      if (char.properties.notify) {
        await char.startNotifications();
        this.subscribedCharacteristics.push(char);
        char.addEventListener('characteristicvaluechanged', (event: any) => {
          const val: DataView = event.target.value;
          const level = val.getUint8(0);
          if (this.onDataCallback) {
            this.onDataCallback({ batteryLevel: level, lastUpdated: Date.now() });
          }
        });
        this.log('info', 'Subscribed to Battery notifications.');
      }
    } catch {
      this.log('info', 'Standard Battery service not detected, checking proprietary battery...');
    }
  }

  /**
   * 3. Heart Rate Service (0x180D)
   */
  private async setupHeartRateService(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const service = await server.getPrimaryService(BLE_SERVICES.HEART_RATE);
      this.log('info', 'Found Heart Rate Service (0x180D)');
      const char = await service.getCharacteristic(BLE_CHARACTERISTICS.HEART_RATE_MEASUREMENT);

      await char.startNotifications();
      this.subscribedCharacteristics.push(char);
      this.log('success', 'Subscribed to Heart Rate notifications!');

      char.addEventListener('characteristicvaluechanged', (event: any) => {
        const value: DataView = event.target.value;
        if (!value || value.byteLength < 2) return;

        const flags = value.getUint8(0);
        const is16Bit = (flags & 0x01) !== 0;
        let hr: number;
        let offset = 1;

        if (is16Bit) {
          hr = value.getUint16(offset, true);
          offset += 2;
        } else {
          hr = value.getUint8(offset);
          offset += 1;
        }

        // Contact detection (bit 1: contact detected, bit 2: contact supported)
        const contactSupported = (flags & 0x04) !== 0;
        const contactDetected = contactSupported ? (flags & 0x02) !== 0 : true;

        // Energy Expended (bit 3)
        if ((flags & 0x08) !== 0) {
          offset += 2;
        }

        // RR intervals (bit 4)
        const rrList: number[] = [];
        if ((flags & 0x10) !== 0) {
          while (offset + 1 < value.byteLength) {
            const rawRR = value.getUint16(offset, true);
            const rrMs = Math.round((rawRR / 1024) * 1000);
            rrList.push(rrMs);
            offset += 2;
          }
        }

        if (this.onDataCallback) {
          this.onDataCallback({
            heartRate: hr,
            sensorContact: contactDetected,
            rrIntervals: rrList,
            lastUpdated: Date.now(),
          });
        }
      });
    } catch {
      this.log('info', 'Standard Heart Rate service (0x180D) not detected.');
    }
  }

  /**
   * 4. Health Thermometer Service (0x1809)
   */
  private async setupHealthThermometerService(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const service = await server.getPrimaryService(BLE_SERVICES.HEALTH_THERMOMETER);
      this.log('info', 'Found Health Thermometer Service (0x1809)');
      const char = await service.getCharacteristic(BLE_CHARACTERISTICS.TEMP_MEASUREMENT);

      await char.startNotifications();
      this.subscribedCharacteristics.push(char);
      this.log('success', 'Subscribed to Health Thermometer notifications!');

      char.addEventListener('characteristicvaluechanged', (event: any) => {
        const value: DataView = event.target.value;
        if (!value || value.byteLength < 5) return;

        const flags = value.getUint8(0);
        const isFahrenheit = (flags & 0x01) !== 0;

        // IEEE-11073 32-bit FLOAT
        const mantissa =
          value.getUint8(1) | (value.getUint8(2) << 8) | (value.getInt8(3) << 16);
        const exponent = value.getInt8(4);
        let temp = mantissa * Math.pow(10, exponent);

        if (isFahrenheit) {
          temp = ((temp - 32) * 5) / 9;
        }

        temp = Math.round(temp * 10) / 10;

        if (this.onDataCallback && temp > 20 && temp < 50) {
          this.onDataCallback({
            skinTemperature: temp,
            lastUpdated: Date.now(),
          });
        }
      });
    } catch {
      // Normal if not exposed as standard service
    }
  }

  /**
   * 5. Aidmed User Service (44366e80-cf3a-11e1-9ab4-0002a5d5c51b)
   * This is where modern firmware streams all biosignals including ECG!
   */
  private async setupAidmedUserService(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const service = await server.getPrimaryService(BLE_SERVICES.AIDMED_USER);
      this.log('success', 'Found Aidmed One Proprietary User Service (44366E80)!');

      const chars = await service.getCharacteristics();
      this.log('info', `Aidmed User Service has ${chars.length} characteristics.`);

      for (const char of chars) {
        const uuid = char.uuid.toLowerCase();

        // Command Characteristic (51366E80)
        // Modern Aidmed One transmits ECG, respiration, temp, and control packets through this characteristic!
        if (uuid.includes('51366e80')) {
          this.commandCharacteristic = char;
          await this.setupCommandCharacteristic(char);
        }

        // Dedicated ECG Characteristic (46366e80) - used in legacy firmware or parallel stream
        if (uuid.includes('46366e80')) {
          await this.subscribeSafely(char, 'Aidmed Legacy ECG Waveform', (val) => {
            const rawBytes = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
            const samples = this.packetParser.parse24BitSamples(rawBytes);
            if (samples.length > 0 && this.onDataCallback) {
              this.onDataCallback({ ecgSamples: samples, lastUpdated: Date.now() });
            }
          });
        }

        // Temperature (45366e80)
        if (uuid.includes('45366e80')) {
          await this.subscribeSafely(char, 'Aidmed Temperature', (val) => {
            const rawBytes = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
            if (rawBytes.length >= 2) {
              const rawTemp = rawBytes[0] | (rawBytes[1] << 8);
              const signed = rawTemp >= 0x8000 ? rawTemp - 0x10000 : rawTemp;
              const temp = Math.round((signed / 100.0) * 10) / 10;
              if (temp > 25 && temp < 45 && this.onDataCallback) {
                this.onDataCallback({ skinTemperature: temp, lastUpdated: Date.now() });
              }
            }
          });
        }

        // Respiration (48366e80)
        if (uuid.includes('48366e80')) {
          await this.subscribeSafely(char, 'Aidmed Respiration', (val) => {
            if (val.byteLength >= 2 && this.onDataCallback) {
              const raw = val.getInt16(0, true);
              this.onDataCallback({ respirationRate: Math.round((raw / 100) * 10) / 10, lastUpdated: Date.now() });
            }
          });
        }

        // Proprietary Battery (47366e80)
        if (uuid.includes('47366e80')) {
          await this.subscribeSafely(char, 'Aidmed Battery', (val) => {
            const battery = val.getUint8(0);
            if (battery <= 100 && this.onDataCallback) {
              this.onDataCallback({ batteryLevel: battery, lastUpdated: Date.now() });
            }
          });
        }
      }

      // Automatically trigger streaming activation commands after setup
      await this.activateStreaming();
    } catch (err: any) {
      this.log('warn', `Aidmed custom user service notice: ${err.message || err}`);
    }
  }

  /**
   * 6. Aidmed Motion Service (60366e80-cf3a-11e1-9ab4-0002a5d5c51b)
   */
  private async setupAidmedMotionService(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const service = await server.getPrimaryService(BLE_SERVICES.AIDMED_MOTION);
      this.log('success', 'Found Aidmed Motion Service!');
      const chars = await service.getCharacteristics();

      for (const char of chars) {
        const uuid = char.uuid.toLowerCase();

        // Steps (62366e80...)
        if (uuid.includes('62366e80')) {
          try {
            const val = await char.readValue();
            const steps = val.byteLength >= 4 ? val.getUint32(0, true) : val.getUint16(0, true);
            if (this.onDataCallback) {
              this.onDataCallback({ steps, lastUpdated: Date.now() });
            }
          } catch {}

          await this.subscribeSafely(char, 'Steps Counter', (val) => {
            const steps = val.byteLength >= 4 ? val.getUint32(0, true) : val.getUint16(0, true);
            if (this.onDataCallback) {
              this.onDataCallback({ steps, lastUpdated: Date.now() });
            }
          });
        }

        // Activity (61366e80...)
        if (uuid.includes('61366e80')) {
          await this.subscribeSafely(char, 'Activity Detection', (val) => {
            const actCode = val.getUint8(0);
            const activityMap: Record<number, string> = {
              0: 'Resting / Unknown',
              1: 'Automotive',
              2: 'Walking',
              4: 'Running',
              8: 'Cycling',
              16: 'Still',
            };
            const act = activityMap[actCode] || 'Active';
            if (this.onDataCallback) {
              this.onDataCallback({ activity: act, lastUpdated: Date.now() });
            }
          });
        }

        // Orientation (63366e80...)
        if (uuid.includes('63366e80')) {
          await this.subscribeSafely(char, 'Orientation Tracker', (val) => {
            if (val.byteLength >= 6) {
              // Roll, Pitch, Yaw as 16-bit signed angles or Q16
              const rawRoll = val.getInt16(0, true);
              const rollDeg = (rawRoll / 100.0);
              const rawPitch = val.getInt16(2, true);
              const pitchDeg = (rawPitch / 100.0);
              const isUpsideDown = Math.abs(rollDeg) > 120 || Math.abs(pitchDeg) > 120;
              if (this.onDataCallback) {
                this.onDataCallback({
                  isUpsideDown,
                  wearState: isUpsideDown ? 'upside_down' : undefined,
                  lastUpdated: Date.now(),
                });
              }
            }
          });
        }
      }
    } catch {}
  }

  /**
   * Setup Command Characteristic notification listener and packet parser
   */
  private async setupCommandCharacteristic(char: BluetoothRemoteGATTCharacteristic): Promise<void> {
    try {
      if (char.properties.notify) {
        await char.startNotifications();
        this.subscribedCharacteristics.push(char);

        char.addEventListener('characteristicvaluechanged', (e: any) => {
          const val: DataView = e.target.value;
          if (!val || val.byteLength === 0) return;

          // Parse incoming chunk via protocol engine
          const parsed = this.packetParser.processCommandChunk(val);

          // If ECG samples were decoded
          if (parsed.ecgSamples && parsed.ecgSamples.length > 0) {
            if (this.onDataCallback) {
              const update: Partial<AidmedParameters> = {
                ecgSamples: parsed.ecgSamples,
                lastUpdated: Date.now(),
              };
              if (parsed.sensorContact !== null && parsed.sensorContact !== undefined) {
                update.sensorContact = parsed.sensorContact;
              }
              if (parsed.wearState !== undefined) {
                update.wearState = parsed.wearState;
              }
              if (parsed.isUpsideDown !== undefined) {
                update.isUpsideDown = parsed.isUpsideDown;
              }
              if (parsed.respirationRate !== null && parsed.respirationRate !== undefined) {
                update.respirationRate = parsed.respirationRate;
              }
              if (parsed.skinTemperature !== null && parsed.skinTemperature !== undefined) {
                update.skinTemperature = parsed.skinTemperature;
              }
              if (parsed.heartRate !== null && parsed.heartRate !== undefined) {
                update.heartRate = parsed.heartRate;
              }
              if (parsed.rrIntervals && parsed.rrIntervals.length > 0) {
                update.rrIntervals = parsed.rrIntervals;
              }
              this.onDataCallback(update);
            }
          } else if (parsed.wearState !== undefined || parsed.sensorContact !== undefined || parsed.isUpsideDown !== undefined) {
            if (this.onDataCallback) {
              const update: Partial<AidmedParameters> = {
                lastUpdated: Date.now(),
              };
              if (parsed.sensorContact !== undefined) update.sensorContact = parsed.sensorContact;
              if (parsed.wearState !== undefined) update.wearState = parsed.wearState;
              if (parsed.isUpsideDown !== undefined) update.isUpsideDown = parsed.isUpsideDown;
              this.onDataCallback(update);
            }
          }

          // If text or debug message
          if (parsed.debugMessage) {
            this.log('info', parsed.debugMessage);
          } else {
            // Check if string response from device
            try {
              const text = new TextDecoder().decode(val);
              if (text && /^[\x20-\x7E\s]+$/.test(text) && text.trim().length > 1) {
                this.log('info', `Device response: ${text.trim()}`);
              }
            } catch {}
          }
        });

        this.log('success', 'Subscribed to Aidmed Command Characteristic (51366E80)!');
      }
    } catch (err: any) {
      this.log('error', `Failed to subscribe to Command Characteristic: ${err.message || err}`);
    }
  }

  /**
   * Activates live streaming by sending collect commands to the device
   */
  public async activateStreaming(): Promise<void> {
    if (!this.commandCharacteristic) {
      this.log('warn', 'Command characteristic not available to send activation.');
      return;
    }

    const char = this.commandCharacteristic;

    // Send commands using both V3 protocol frame and raw chunk formats
    const commandsToSend = [
      // 1. V3 formatted command: collect flags for all signals (0x0000FFFF covers ECG, Resp, Temp, Motion, Orient, Steps, HR, etc.)
      { name: 'V3 Collect Flags (Live Full Telemetry)', chunks: AidmedPacketParser.buildCommandChunks('collect flags 0000FFFF 00000000') },
      { name: 'V3 Collect Flags (Live Standard)', chunks: AidmedPacketParser.buildCommandChunks('collect flags 000000FF 00000000') },
      // 2. Raw null-terminated collect flags
      { name: 'Raw Collect Flags (Full)', chunks: AidmedPacketParser.buildRawChunks('collect flags 0000FFFF 00000000') },
      { name: 'Raw Collect Flags', chunks: AidmedPacketParser.buildRawChunks('collect flags 000000FF 00000000') },
      // 3. Collect on binary flags (older firmware: prefix "collect on " + 4 bytes live flags + 4 bytes sync flags)
      {
        name: 'Binary Collect On',
        chunks: [
          new Uint8Array([
            99, 111, 108, 108, 101, 99, 116, 32, 111, 110, 32, // "collect on "
            0, 0, 255, 255, // live flags: 0x0000FFFF
            0, 0, 0, 0, // sync flags: 0x00000000
          ]),
        ],
      },
    ];

    for (const cmd of commandsToSend) {
      try {
        this.log('info', `Sending activation command: ${cmd.name}...`);
        for (const chunk of cmd.chunks) {
          if (char.properties.writeWithoutResponse) {
            await char.writeValueWithoutResponse(chunk);
          } else {
            await char.writeValue(chunk);
          }
        }
        this.log('success', `Activation command sent (${cmd.name}).`);
        // Small delay between command attempts
        await new Promise((r) => setTimeout(r, 120));
      } catch (err: any) {
        this.log('warn', `Notice for ${cmd.name}: ${err.message || err}`);
      }
    }
  }

  private async subscribeSafely(
    char: BluetoothRemoteGATTCharacteristic,
    name: string,
    handler: (dataView: DataView) => void
  ): Promise<void> {
    try {
      if (char.properties.notify || char.properties.indicate) {
        await char.startNotifications();
        this.subscribedCharacteristics.push(char);
        char.addEventListener('characteristicvaluechanged', (event: any) => {
          const val: DataView = event.target.value;
          if (val) handler(val);
        });
        this.log('info', `Subscribed to ${name}.`);
      }
    } catch (err: any) {
      this.log('warn', `Could not subscribe to ${name}: ${err.message || err}`);
    }
  }
}

export const aidmedBleService = new AidmedBleService();
