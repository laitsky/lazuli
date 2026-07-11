import type { RealtimeEvent, RealtimeTopic } from '@lazuli/shared';

import type { EmitEvent, ProviderHealth, ProviderName } from '../types.ts';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export abstract class ExchangeAdapter {
  readonly health: ProviderHealth;
  protected socket: WebSocket | null = null;
  protected stopped = true;
  protected readonly sequences = new Map<RealtimeTopic, number>();
  private reconnectAttempt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconciling = false;

  protected constructor(
    readonly provider: ProviderName,
    protected readonly symbols: string[],
    protected readonly emit: EmitEvent
  ) {
    this.health = {
      provider,
      state: 'stopped',
      connectedAt: null,
      lastMessageAt: null,
      lastEventAt: null,
      reconnects: 0,
      sequenceGaps: 0,
      parseErrors: 0,
      eventsEmitted: 0,
      lastError: null,
    };
  }

  protected abstract get websocketUrl(): string;
  protected abstract subscribe(socket: WebSocket): void;
  protected abstract handleMessage(message: string): void | Promise<void>;

  protected heartbeat(socket: WebSocket): void {
    socket.send('ping');
  }

  protected async reconcileAll(): Promise<void> {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.health.state = 'stopped';
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.socket?.close(1000, 'shutdown');
    this.socket = null;
  }

  protected publish(event: RealtimeEvent): void {
    this.health.lastEventAt = Date.now();
    this.health.eventsEmitted += 1;
    this.emit(event);
  }

  protected nextSequence(topic: RealtimeTopic): number {
    const next = (this.sequences.get(topic) ?? 0) + 1;
    this.sequences.set(topic, next);
    return next;
  }

  protected detectGap(key: string, previous: number | null, current: number): void {
    if (previous !== null && current > previous + 1) {
      this.health.sequenceGaps += 1;
      this.health.state = 'degraded';
      this.health.lastError = `sequence gap on ${key}: expected ${previous + 1}, received ${current}`;
      void this.reconcileSafely();
    }
  }

  protected parseError(error: unknown): void {
    this.health.parseErrors += 1;
    this.health.lastError = error instanceof Error ? error.message : String(error);
  }

  private connect(): void {
    if (this.stopped) return;
    this.health.state = 'connecting';

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.websocketUrl);
    } catch (error) {
      this.scheduleReconnect(error);
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      this.reconnectAttempt = 0;
      this.health.state = 'connected';
      this.health.connectedAt = Date.now();
      this.health.lastMessageAt = Date.now();
      this.health.lastError = null;
      try {
        this.subscribe(socket);
        void this.reconcileSafely();
      } catch (error) {
        this.parseError(error);
        socket.close(1011, 'subscription failed');
      }
      this.startHeartbeat(socket);
    });

    socket.addEventListener('message', (event) => {
      if (socket !== this.socket) return;
      this.health.lastMessageAt = Date.now();
      void this.decode(event.data)
        .then((message) => this.handleMessage(message))
        .catch((error: unknown) => this.parseError(error));
    });

    socket.addEventListener('error', () => {
      this.health.lastError = 'websocket transport error';
    });

    socket.addEventListener('close', (event) => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.scheduleReconnect(`websocket closed (${event.code}): ${event.reason || 'no reason'}`);
    });
  }

  private startHeartbeat(socket: WebSocket): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
      const silence = Date.now() - (this.health.lastMessageAt ?? 0);
      if (silence > 45_000) {
        this.health.state = 'degraded';
        socket.close(4000, 'heartbeat timeout');
        return;
      }
      try {
        this.heartbeat(socket);
      } catch (error) {
        this.parseError(error);
        socket.close(1011, 'heartbeat failed');
      }
    }, 15_000);
  }

  private scheduleReconnect(error: unknown): void {
    if (this.stopped) return;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.health.state = 'disconnected';
    this.health.lastError = error instanceof Error ? error.message : String(error);
    this.health.reconnects += 1;
    const base = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempt, 6));
    const wait = Math.floor(base / 2 + Math.random() * base);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), wait);
  }

  private async reconcileSafely(): Promise<void> {
    if (this.reconciling || this.stopped) return;
    this.reconciling = true;
    try {
      await this.reconcileAll();
      if (this.health.state === 'degraded') this.health.state = 'connected';
    } catch (error) {
      this.health.state = 'degraded';
      this.parseError(error);
      await delay(250);
    } finally {
      this.reconciling = false;
    }
  }

  private async decode(data: unknown): Promise<string> {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
    if (data instanceof Blob) return data.text();
    throw new Error('unsupported websocket message type');
  }
}
