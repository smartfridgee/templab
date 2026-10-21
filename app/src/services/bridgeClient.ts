/**
 * WebSocket client for the Python Aidlab bridge (bridge/aidlab_bridge.py).
 * Reconnects automatically, so the bridge can be started before or after the UI.
 */

import { BridgeCommand, BridgeMessage } from '../types/telemetry';

export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:8765';

type MessageListener = (msg: BridgeMessage) => void;
type ConnectionListener = (online: boolean) => void;

export class BridgeClient {
  private ws: WebSocket | null = null;
  private retryTimer: number | null = null;
  private running = false;
  private online = false;
  private messageListeners = new Set<MessageListener>();
  private connectionListeners = new Set<ConnectionListener>();

  constructor(private readonly url: string = DEFAULT_BRIDGE_URL) {}

  get isOnline(): boolean {
    return this.online;
  }

  get address(): string {
    return this.url;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.open();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setOnline(false);
  }

  send(cmd: BridgeCommand): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(cmd));
    return true;
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.online);
    return () => this.connectionListeners.delete(listener);
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => this.setOnline(true);
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const l of this.messageListeners) l(msg);
    };
    ws.onerror = () => {
      /* onclose follows and handles the retry */
    };
    ws.onclose = () => {
      this.ws = null;
      this.setOnline(false);
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer !== null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.running) this.open();
    }, 1500);
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    for (const l of this.connectionListeners) l(online);
  }
}

export const bridgeClient = new BridgeClient();
