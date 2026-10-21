#!/usr/bin/env python3
"""
Aidlab / Aidmed One -> WebSocket bridge.

Why this exists
---------------
Aidlab and Aidmed One firmware (>= 3.6) send every biosignal through one BLE
command characteristic (51366E80), using a proprietary, compressed framing
protocol. Only Aidlab's official native SDK decodes it. The SDK is MIT licensed
and ships with the `aidlabsdk` Python package as aidlabsdk.dylib / .dll / .so.
Guessing the byte layout in TypeScript gives noise, so this bridge:

  1. scans for and connects to the device with the official SDK (BLE via bleak),
  2. starts live collection of ECG and the vitals,
  3. streams the decoded samples to the React UI over a local WebSocket.

The UI only displays the data. It never parses BLE bytes.

Usage
-----
    python3 -m pip install -r bridge/requirements.txt
    python3 bridge/aidlab_bridge.py            # ws://127.0.0.1:8765

Protocol (JSON text frames)
---------------------------
Client -> bridge:
    {"type": "scan"}
    {"type": "connect", "address": "<address from scan>"}
    {"type": "disconnect"}

Bridge -> client:
    {"type": "status", "state": "idle|scanning|connecting|connected", "device": {...} | null}
    {"type": "devices", "devices": [{"address", "name", "rssi"}]}
    {"type": "ecg", "fs": 250, "t": [ms...], "v": [mV...]}      batched, ~25 frames/s
    {"type": "heart_rate", "value": bpm}
    {"type": "rr", "value": ms}
    {"type": "skin_temperature", "value": degC}
    {"type": "respiration_rate", "value": breaths_per_min}
    {"type": "battery", "value": percent}
    {"type": "steps", "value": n}
    {"type": "signal_quality", "value": 0..100}
    {"type": "wear_state", "value": "proper|upside_down|loose|detached|unknown|unsettled"}
    {"type": "log", "level": "info|success|warn|error", "message": str}
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from typing import Any

try:
    from aidlab import (
        BleakTransport,
        DataType,
        Device,
        DeviceDelegate,
        DeviceEventType,
        DisconnectReason,
        WearState,
        WearStateEvent,
    )
    from bleak import BleakScanner
except ImportError as exc:  # pragma: no cover - friendly message for missing deps
    sys.stderr.write(
        f"Missing dependency: {exc}.\n"
        "Install the bridge requirements with:\n"
        "    python3 -m pip install -r bridge/requirements.txt\n"
    )
    sys.exit(1)

try:  # websockets >= 13
    from websockets.asyncio.server import ServerConnection, serve
except ImportError:  # pragma: no cover - older websockets
    from websockets.server import WebSocketServerProtocol as ServerConnection  # type: ignore
    from websockets.server import serve  # type: ignore

log = logging.getLogger("aidlab-bridge")

ECG_SAMPLE_RATE_HZ = 250
FLUSH_INTERVAL_S = 0.04  # 25 ECG frames per second to the UI

# Aidlab/Aidmed user service, advertised by the devices.
AIDLAB_USER_SERVICE = "44366e80-cf3a-11e1-9ab4-0002a5d5c51b"
NAME_PREFIXES = ("aidlab", "aidmed")

# What we ask the device to stream live. Types the firmware does not support
# are dropped automatically (see _collect_supported).
LIVE_DATA_TYPES = [
    DataType.ECG,
    DataType.HEART_RATE,
    DataType.RR,
    DataType.RESPIRATION_RATE,
    DataType.SKIN_TEMPERATURE,
    DataType.STEPS,
]
LIVE_EVENTS = [DeviceEventType.WEAR_STATE]

WEAR_STATE_NAMES = {
    WearState.PLACED_PROPERLY: "proper",
    WearState.PLACED_UPSIDE_DOWN: "upside_down",
    WearState.LOOSE: "loose",
    WearState.DETACHED: "detached",
    WearState.UNKNOWN: "unknown",
    WearState.UNSETTLED: "unsettled",
}


class Bridge(DeviceDelegate):
    def __init__(self) -> None:
        self.clients: set[ServerConnection] = set()
        self.state = "idle"
        self.device: Device | None = None
        self.device_info: dict[str, Any] | None = None
        self.scan_results: dict[str, Any] = {}  # address -> BLEDevice
        self._op_lock = asyncio.Lock()

        # ECG samples gathered between flushes.
        self._ecg_t: list[int] = []
        self._ecg_v: list[float] = []

    # ------------------------------------------------------------------ I/O

    async def broadcast(self, message: dict[str, Any]) -> None:
        if not self.clients:
            return
        data = json.dumps(message, separators=(",", ":"))
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def emit(self, message: dict[str, Any]) -> None:
        """Fire-and-forget broadcast, safe to call from SDK callbacks (they run on the event loop)."""
        asyncio.get_running_loop().create_task(self.broadcast(message))

    def log(self, level: str, message: str) -> None:
        py_level = {"info": logging.INFO, "success": logging.INFO, "warn": logging.WARNING}.get(level, logging.ERROR)
        log.log(py_level, message)
        self.emit({"type": "log", "level": level, "message": message})

    def status_message(self) -> dict[str, Any]:
        return {"type": "status", "state": self.state, "device": self.device_info}

    async def set_state(self, state: str) -> None:
        self.state = state
        await self.broadcast(self.status_message())

    async def ecg_flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            if not self._ecg_v:
                continue
            t, v = self._ecg_t, self._ecg_v
            self._ecg_t, self._ecg_v = [], []
            await self.broadcast({"type": "ecg", "fs": ECG_SAMPLE_RATE_HZ, "t": t, "v": v})

    # ------------------------------------------------------------ commands

    async def handle_client(self, ws: ServerConnection) -> None:
        self.clients.add(ws)
        try:
            await ws.send(json.dumps(self.status_message()))
            if self.scan_results:
                await ws.send(json.dumps(self._devices_message()))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                kind = msg.get("type")
                if kind == "scan":
                    asyncio.create_task(self.scan())
                elif kind == "connect":
                    asyncio.create_task(self.connect(str(msg.get("address", ""))))
                elif kind == "disconnect":
                    asyncio.create_task(self.disconnect())
        except Exception as exc:  # connection closed etc.
            log.debug("client closed: %s", exc)
        finally:
            self.clients.discard(ws)

    def _devices_message(self) -> dict[str, Any]:
        return {
            "type": "devices",
            "devices": [
                {"address": addr, "name": info["name"], "rssi": info["rssi"]}
                for addr, info in self.scan_results.items()
            ],
        }

    async def scan(self, timeout: float = 6.0) -> None:
        if self._op_lock.locked() or self.state == "connected":
            self.log("warn", "Busy - disconnect first before scanning.")
            return
        async with self._op_lock:
            await self.set_state("scanning")
            self.log("info", f"Scanning for Aidlab / Aidmed devices ({timeout:.0f} s)...")
            self.scan_results = {}
            try:
                found = await BleakScanner.discover(timeout=timeout, return_adv=True)
                for ble_device, adv in found.values():
                    name = ble_device.name or adv.local_name or ""
                    uuids = [u.lower() for u in (adv.service_uuids or [])]
                    if name.lower().startswith(NAME_PREFIXES) or AIDLAB_USER_SERVICE in uuids:
                        self.scan_results[ble_device.address] = {
                            "device": ble_device,
                            "name": name or "Aidlab device",
                            "rssi": adv.rssi,
                        }
                n = len(self.scan_results)
                self.log("success" if n else "warn", f"Scan finished: {n} compatible device(s) found.")
            except Exception as exc:
                self.log("error", f"Bluetooth scan failed: {exc}")
            finally:
                await self.broadcast(self._devices_message())
                await self.set_state("idle")

    async def connect(self, address: str) -> None:
        if self._op_lock.locked() or self.state == "connected":
            self.log("warn", "Busy - already connecting or connected.")
            return
        entry = self.scan_results.get(address)
        if entry is None:
            self.log("error", f"Unknown device {address!r}. Scan first.")
            return

        async with self._op_lock:
            await self.set_state("connecting")
            self.log("info", f"Connecting to {entry['name']} ({address})...")
            # Device instances are single-use in the SDK, so create a new one per attempt.
            device = Device(address=address, name=entry["name"], transport=BleakTransport(entry["device"]))
            try:
                await device.connect(self)
            except Exception as exc:
                self.log("error", f"Connection failed: {exc}")
                await self.set_state("idle")
                return

            self.device = device
            self.device_info = {
                "address": address,
                "name": device.name,
                "firmwareRevision": device.firmware_revision,
                "hardwareRevision": device.hardware_revision,
                "serialNumber": device.serial_number,
                "manufacturer": device.manufacturer_name,
            }
            await self.set_state("connected")
            self.log(
                "success",
                f"Connected: {device.name} | FW {device.firmware_revision} | HW {device.hardware_revision}",
            )
            await self._collect_supported(device)

    async def _collect_supported(self, device: Device) -> None:
        """Start live collection. Retries without types the firmware rejects."""
        wanted = list(LIVE_DATA_TYPES)
        events = list(LIVE_EVENTS)
        for _ in range(len(LIVE_DATA_TYPES) + 1):
            try:
                await device.collect(wanted, [], events)
                self.log("success", "Live collection started: " + ", ".join(t.name for t in wanted))
                return
            except ValueError as exc:
                # The SDK rejects unsupported types before sending anything, e.g.
                # "Firmware 3.6.0 does not support: HEART_RATE, RR"
                unsupported = set(re.findall(r"[A-Z_]{2,}", str(exc).split(":", 1)[-1]))
                reduced_events = [e for e in events if e.name not in unsupported]
                reduced = [t for t in wanted if t.name not in unsupported]
                if reduced_events == events and (reduced == wanted or not reduced):
                    if wanted == [DataType.ECG] and not events:
                        self.log("error", f"Collect failed: {exc}")
                        return
                    reduced, reduced_events = [DataType.ECG], []
                self.log("warn", f"{exc} - retrying without them.")
                wanted, events = reduced or [DataType.ECG], reduced_events
            except Exception as exc:
                self.log("error", f"Collect failed: {exc}")
                return

    async def disconnect(self) -> None:
        device = self.device
        if device is None:
            return
        self.log("info", "Disconnecting...")
        try:
            await device.disconnect()
        except Exception as exc:
            self.log("warn", f"Disconnect error: {exc}")

    # ------------------------------------------------- SDK delegate callbacks

    def did_connect(self, device: Device) -> None:  # collect is started after connect() returns
        pass

    def did_disconnect(self, device: Device, reason: DisconnectReason) -> None:
        if device is not self.device:
            return
        self.device = None
        self.device_info = None
        self._ecg_t, self._ecg_v = [], []
        self.state = "idle"
        self.emit(self.status_message())
        self.log("warn", f"Device disconnected ({reason.name}).")

    def did_receive_error(self, device: Device, error: Any) -> None:
        self.log("error", f"SDK error: {error}")

    def did_receive_ecg(self, device: Device, timestamp: int, value: float) -> None:
        # The SDK reports ECG in volts. The UI works in millivolts.
        self._ecg_t.append(int(timestamp))
        self._ecg_v.append(round(value * 1000.0, 5))

    def did_receive_heart_rate(self, device: Device, timestamp: int, heart_rate: int) -> None:
        self.emit({"type": "heart_rate", "value": heart_rate})

    def did_receive_rr(self, device: Device, timestamp: int, rr: int) -> None:
        self.emit({"type": "rr", "value": rr})

    def did_receive_skin_temperature(self, device: Device, timestamp: int, value: float) -> None:
        self.emit({"type": "skin_temperature", "value": round(value, 2)})

    def did_receive_respiration_rate(self, device: Device, timestamp: int, value: int) -> None:
        self.emit({"type": "respiration_rate", "value": value})

    def did_receive_battery_level(self, device: Device, state_of_charge: int) -> None:
        self.emit({"type": "battery", "value": state_of_charge})

    def did_receive_steps(self, device: Device, timestamp: int, steps: int) -> None:
        self.emit({"type": "steps", "value": steps})

    def did_receive_signal_quality(self, device: Device, timestamp: int, value: int) -> None:
        self.emit({"type": "signal_quality", "value": value})

    def did_receive_event(self, device: Device, event: Any) -> None:
        if isinstance(event, WearStateEvent) and not event.is_past:
            name = WEAR_STATE_NAMES.get(event.wear_state, "unknown")
            self.emit({"type": "wear_state", "value": name})
            self.log("info", f"Wear state: {name}")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Aidlab / Aidmed One WebSocket bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    bridge = Bridge()
    flusher = asyncio.create_task(bridge.ecg_flush_loop())
    async with serve(bridge.handle_client, args.host, args.port, max_size=2**20):
        log.info("Aidlab bridge listening on ws://%s:%d", args.host, args.port)
        try:
            await asyncio.Future()
        finally:
            flusher.cancel()
            await bridge.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
