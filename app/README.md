# Aidmed One / Aidlab Monitor (Tauri V2 + Official Aidlab SDK Bridge)

## Why this architecture?
Aidlab and Aidmed One firmware (`>= 3.6`) transmit all biosignals over the `51366E80` BLE command characteristic using a proprietary, compressed framing protocol that is decoded by Aidlab's native C++ SDK (`aidlabsdk.dylib` / `.dll` / `.so` shipped in the MIT-licensed `aidlabsdk` Python package).

1. **Python BLE Bridge ([bridge/aidlab_bridge.py](bridge/aidlab_bridge.py))**: Uses `aidlabsdk` + `bleak` to scan, connect, and decode real 250 Hz ECG samples (in physical Volts -> converted to mV), heart rate, RR intervals, respiration rate, skin temperature, battery, steps, and electrode wear state, streaming them over `ws://127.0.0.1:8765`.
2. **Zero-Drop Ring Buffer ([src/services/ecgBuffer.ts](src/services/ecgBuffer.ts))**: Incoming 250 Hz ECG batches bypass React state entirely and are written directly into a typed-array ring buffer so React state batching never drops packets.
3. **RBJ Biquad Display Filter ([src/services/ecgFilter.ts](src/services/ecgFilter.ts))**: Primed 0.5 Hz high-pass (removes electrode DC offset & breathing wander), 50/60 Hz notch (removes powerline hum), and 40 Hz low-pass (monitor bandwidth).
4. **Calibrated 60 FPS Canvas Monitor ([src/components/ECGMonitor.tsx](src/components/ECGMonitor.tsx))**: Renders standard 25 mm/s, 10 mm/mV ECG paper with a 1 mV calibration pulse, ICU Sweep (erase bar) and Strip-Chart Scroll modes.

## Quick Start

### 1. Install & Run the Python BLE Bridge
```bash
cd app
python3 -m pip install -r bridge/requirements.txt
npm run bridge
```

### 2. Run the Frontend / Tauri App
```bash
cd app
npm install
npm run dev
# or for the Tauri desktop window:
npm run tauri dev
```
