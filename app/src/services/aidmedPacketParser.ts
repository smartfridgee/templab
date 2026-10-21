/**
 * Aidmed One / Aidlab BLE Protocol Decoder and Packet Parser
 *
 * Implements decoding for:
 * - V3 Protocol Chunks (used by firmware 3.6.0 - 3.8.x)
 * - V4 Protocol Chunks (used by firmware 4.0.0+)
 * - Session Payload Deserialization (Start/End timestamp, LeadOff status, Data slots)
 * - 24-bit ADC ECG Sample Parsing (1 sample = 3 bytes big-endian)
 * - Legacy GATT Characteristic Parsing (46366e80)
 */

import { WearState } from '../types/bluetooth';

export interface ParsedPacketResult {
  ecgSamples: number[]; // in millivolts (mV)
  respirationRate?: number;
  skinTemperature?: number;
  sensorContact?: boolean;
  wearState?: WearState;
  isUpsideDown?: boolean;
  heartRate?: number;
  rrIntervals?: number[];
  debugMessage?: string;
}

export class AidmedPacketParser {
  private buffer: number[] = [];
  private expectedPayloadLength: number = 0;
  private currentPid: number = 0;
  private protocolVersion: number = 0;
  private isCollecting: boolean = false;

  constructor() {}

  public reset(): void {
    this.buffer = [];
    this.expectedPayloadLength = 0;
    this.currentPid = 0;
    this.protocolVersion = 0;
    this.isCollecting = false;
  }

  public getProtocolVersion(): number {
    return this.protocolVersion;
  }

  public getCurrentPid(): number {
    return this.currentPid;
  }

  /**
   * Process an incoming chunk from the command characteristic (51366E80)
   */
  public processCommandChunk(dataView: DataView): ParsedPacketResult {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    if (bytes.length === 0) return { ecgSamples: [] };

    const results: ParsedPacketResult = { ecgSamples: [] };

    // Check if this chunk is the start of a new V3 or V4 frame
    // Magic: byte 1 is 0x0A (10)
    if (bytes.length >= 7 && bytes[1] === 0x0a) {
      const proto = bytes[0];

      if (proto === 0x03) {
        // V3 Header (7 bytes)
        // Byte 0: 0x03
        // Byte 1: 0x0A
        // Byte 2: type (0x01 = data, 0x00 = control, 0x63 = cmd response)
        // Byte 3..4: total length (uint16 LE) including 7-byte header
        // Byte 5..6: PID (uint16 LE, e.g. 8 for collect)
        const totalLen = bytes[3] | (bytes[4] << 8);
        const pid = bytes[5] | (bytes[6] << 8);

        this.protocolVersion = 3;
        this.currentPid = pid;
        // Payload size without the 7-byte header
        this.expectedPayloadLength = Math.max(0, totalLen - 7);
        this.buffer = [];
        this.isCollecting = true;

        // Append remaining payload bytes in this chunk
        for (let i = 7; i < bytes.length; i++) {
          this.buffer.push(bytes[i]);
        }

        results.debugMessage = `V3 Frame Header: PID=${pid}, payloadLen=${this.expectedPayloadLength}`;
      } else if (proto === 0x04) {
        // V4 Header (18 bytes)
        if (bytes.length >= 18) {
          const payloadLen = bytes[3] | (bytes[4] << 8);
          const pid = bytes[5] | (bytes[6] << 8);

          this.protocolVersion = 4;
          this.currentPid = pid;
          this.expectedPayloadLength = payloadLen;
          this.buffer = [];
          this.isCollecting = true;

          for (let i = 18; i < bytes.length; i++) {
            this.buffer.push(bytes[i]);
          }

          results.debugMessage = `V4 Frame Header: PID=${pid}, payloadLen=${payloadLen}`;
        }
      } else if (proto === 0x01 || proto === 0x02) {
        // V1 / V2 Header (5 bytes)
        const payloadLen = bytes[3] | (bytes[4] << 8);
        this.protocolVersion = proto;
        this.currentPid = 0;
        this.expectedPayloadLength = Math.max(0, payloadLen - 5);
        this.buffer = [];
        this.isCollecting = true;

        for (let i = 5; i < bytes.length; i++) {
          this.buffer.push(bytes[i]);
        }
      }
    } else if (this.isCollecting && this.expectedPayloadLength > 0) {
      // Continuation chunk of an in-progress frame
      for (let i = 0; i < bytes.length; i++) {
        this.buffer.push(bytes[i]);
      }
    } else {
      // If no frame header matched, attempt direct session or raw sample parsing
      const direct = this.tryDirectParse(bytes);
      if (direct.ecgSamples.length > 0) {
        return direct;
      }
    }

    // Check if the buffered payload is complete
    if (this.isCollecting && this.buffer.length >= this.expectedPayloadLength && this.expectedPayloadLength > 0) {
      const payload = new Uint8Array(this.buffer.slice(0, this.expectedPayloadLength));
      this.isCollecting = false;
      this.expectedPayloadLength = 0;

      // Deserialize session payload
      const sessionResult = this.deserializeSessionPayload(payload);
      return {
        ...results,
        ...sessionResult,
      };
    }

    return results;
  }

  /**
   * Deserializes an assembled session packet payload (Session::deserialize)
   */
  private deserializeSessionPayload(payload: Uint8Array): ParsedPacketResult {
    const result: ParsedPacketResult = { ecgSamples: [] };

    // Minimum session header is 17 bytes:
    // Bytes 0..7: Start Timestamp (uint64 LE)
    // Bytes 8..15: End Timestamp (uint64 LE)
    // Byte 16: Wear state (Aidlab/Aidmed WearState enum):
    //   0: PLACED_PROPERLY (Electrodes on body, normal upright position)
    //   1: PLACED_UPSIDE_DOWN (Electrodes on body, but device is worn upside down!)
    //   2: LOOSE (Poor skin contact / loose strap)
    //   3: DETACHED (Leads off / detached from person)
    //   4: UNKNOWN
    //   5: UNSETTLED (Impedance settling)
    if (payload.length < 17) {
      return result;
    }

    const wearCode = payload[16];
    let wearState: WearState = 'unknown';
    let sensorContact = false;
    let isUpsideDown = false;

    switch (wearCode) {
      case 0:
        wearState = 'proper';
        sensorContact = true;
        isUpsideDown = false;
        break;
      case 1:
        wearState = 'upside_down';
        sensorContact = true; // Still in contact with skin, but inverted!
        isUpsideDown = true;
        break;
      case 2:
        wearState = 'loose';
        sensorContact = false;
        isUpsideDown = false;
        break;
      case 3:
        wearState = 'detached';
        sensorContact = false;
        isUpsideDown = false;
        break;
      case 5:
        wearState = 'unsettled';
        sensorContact = false;
        isUpsideDown = false;
        break;
      default:
        wearState = 'unknown';
        sensorContact = wearCode === 0;
        isUpsideDown = false;
    }

    result.wearState = wearState;
    result.sensorContact = sensorContact;
    result.isUpsideDown = isUpsideDown;

    let offset = 17;
    let slotIndex = 0;

    // Parse data slots
    while (offset + 2 <= payload.length) {
      const slotLength = payload[offset] | (payload[offset + 1] << 8);
      offset += 2;

      if (offset + slotLength > payload.length) {
        break;
      }

      const slotData = payload.subarray(offset, offset + slotLength);

      if (slotIndex === 0) {
        // Slot 0: ECG Data
        // Each sample is 24-bit little-endian (3 bytes: LSB, MID, MSB)
        result.ecgSamples = this.parse24BitSamples(slotData);
      } else if (slotIndex === 1) {
        // Slot 1: Respiration Data
        if (slotData.length >= 2) {
          const respRaw = slotData[0] | (slotData[1] << 8);
          result.respirationRate = Math.round((respRaw / 100) * 10) / 10;
        }
      } else if (slotIndex === 2) {
        // Slot 2: Skin Temperature Data (centidegrees / 100)
        if (slotData.length >= 2) {
          const rawTemp = slotData[0] | (slotData[1] << 8);
          // Convert signed int16
          const signedTemp = rawTemp >= 0x8000 ? rawTemp - 0x10000 : rawTemp;
          const tempC = signedTemp / 100.0;
          if (tempC > 20 && tempC < 45) {
            result.skinTemperature = Math.round(tempC * 10) / 10;
          }
        }
      } else if (slotIndex === 11) {
        // Slot 11: Heart Rate
        if (slotData.length >= 1) {
          const hr = slotData[0];
          if (hr > 30 && hr < 240) {
            result.heartRate = hr;
          }
        }
      } else if (slotIndex === 12) {
        // Slot 12: RR Interval
        if (slotData.length >= 2) {
          const rr = slotData[0] | (slotData[1] << 8);
          if (rr > 200 && rr < 3000) {
            result.rrIntervals = [rr];
          }
        }
      }

      offset += slotLength;
      slotIndex++;
    }

    return result;
  }

  /**
   * Parse 24-bit little-endian ECG samples into millivolts (mV)
   *
   * Aidmed One / Aidlab ADC layout:
   * Byte 0: LSB (bits 0..7)
   * Byte 1: MID (bits 8..15)
   * Byte 2: MSB (bits 16..23, signed two's complement)
   */
  public parse24BitSamples(bytes: Uint8Array): number[] {
    const samples: number[] = [];
    const count = Math.floor(bytes.length / 3);

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const b0 = bytes[idx];     // LSB
      const b1 = bytes[idx + 1]; // MID
      const b2 = bytes[idx + 2]; // MSB

      // Assemble 24-bit little-endian integer
      let raw = b0 | (b1 << 8) | (b2 << 16);

      // Sign-extend 24-bit to 32-bit (bit 23 is the sign bit)
      if (raw & 0x800000) {
        raw -= 0x1000000;
      }

      // Convert to Volts (div by 2^24) then to Millivolts (* 1000)
      // Range is ±0.4V (±400mV) across 24-bit pipeline
      const voltageVolts = raw / 16777216.0;
      const voltageMv = voltageVolts * 1000.0;

      // Filter extreme out-of-range artifacts (±15 mV max plausible bio-potential)
      if (voltageMv > -15.0 && voltageMv < 15.0) {
        samples.push(voltageMv);
      }
    }

    return samples;
  }

  /**
   * Fallback: direct check for 20-byte legacy packets (46366E80) or unheadered raw streams
   */
  public tryDirectParse(bytes: Uint8Array): ParsedPacketResult {
    const result: ParsedPacketResult = { ecgSamples: [] };

    // Standard legacy Aidlab ECG packet: 20 bytes
    // 6 samples * 3 bytes = 18 bytes, followed by 2 bytes timestamp
    if (bytes.length === 20) {
      const sampleBytes = bytes.subarray(0, 18);
      const samples = this.parse24BitSamples(sampleBytes);
      if (samples.length > 0) {
        result.ecgSamples = samples;
        return result;
      }
    }

    // Direct multiples of 3 bytes (raw 24-bit samples)
    if (bytes.length >= 6 && bytes.length % 3 === 0) {
      const samples = this.parse24BitSamples(bytes);
      if (samples.length > 0) {
        result.ecgSamples = samples;
        return result;
      }
    }

    return result;
  }

  /**
   * Generates formatted command packets chunked to <= 20 bytes for safe BLE transmission
   */
  public static buildCommandChunks(commandText: string): Uint8Array[] {
    const encoder = new TextEncoder();
    const cmdBytes = encoder.encode(commandText);

    // Build payload with null terminator (0x00)
    const payload = new Uint8Array(cmdBytes.length + 1);
    payload.set(cmdBytes);
    payload[cmdBytes.length] = 0; // null terminator required by Aidlab firmware

    // Create V3 Header: [0x03, 0x0A, 0x63, len_lo, len_hi, 0, 0]
    const totalLen = payload.length + 7;
    const fullFrame = new Uint8Array(totalLen);
    fullFrame[0] = 0x03; // V3 protocol
    fullFrame[1] = 0x0a; // Magic 0x0A
    fullFrame[2] = 0x63; // Command type 'c'
    fullFrame[3] = totalLen & 0xff;
    fullFrame[4] = (totalLen >> 8) & 0xff;
    fullFrame[5] = 0x00; // PID low
    fullFrame[6] = 0x00; // PID high
    fullFrame.set(payload, 7);

    // Split frame into <= 20-byte chunks for ATT MTU safety
    const chunks: Uint8Array[] = [];
    const chunkSize = 20;

    for (let offset = 0; offset < fullFrame.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, fullFrame.length);
      chunks.push(fullFrame.slice(offset, end));
    }

    return chunks;
  }

  /**
   * Raw null-terminated chunks (fallback for firmware that handles shell without V3 wrapper)
   */
  public static buildRawChunks(commandText: string): Uint8Array[] {
    const encoder = new TextEncoder();
    const cmdBytes = encoder.encode(commandText);
    const payload = new Uint8Array(cmdBytes.length + 1);
    payload.set(cmdBytes);
    payload[cmdBytes.length] = 0;

    const chunks: Uint8Array[] = [];
    const chunkSize = 20;

    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, payload.length);
      chunks.push(payload.slice(offset, end));
    }

    return chunks;
  }
}
