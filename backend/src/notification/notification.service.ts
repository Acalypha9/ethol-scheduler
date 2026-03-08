import { Injectable, Logger, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { WebSocket as WsClient } from 'ws';
import { NotificationGateway } from './notification.gateway';
import type { WebSocket } from 'ws';
import { SyncService } from '../sync/sync.service';

const ETHOL_WS_URL = 'wss://chat.ethol.pens.ac.id/socket';
const ETHOL_API_BASE = 'https://ethol.pens.ac.id';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MIN_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_INTERVAL_MS = 8_000;
const UPSTREAM_CONNECT_TIMEOUT_MS = 5_000;

interface UpstreamConnection {
  ws: WsClient;
  token: string;
  opened: boolean;
  connectTimeout: NodeJS.Timeout;
  expectedPollingFallback: boolean;
}

@Injectable()
export class NotificationService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private upstreamConnections = new Map<string, UpstreamConnection>();
  private upstreamPollingOnlyTokens = new Set<string>();
  private pollIntervals = new Map<string, NodeJS.Timeout>();
  private seenNotifications = new Map<string, Set<string>>();

  constructor(
    @Inject(forwardRef(() => NotificationGateway)) private readonly gateway: NotificationGateway,
    private readonly syncService: SyncService,
  ) { }

  onModuleDestroy() {
    // Clean up all upstream connections and intervals
    for (const [, conn] of this.upstreamConnections) {
      clearTimeout(conn.connectTimeout);
      conn.ws.close();
    }
    for (const [, timeout] of this.pollIntervals) {
      clearTimeout(timeout);
    }
  }

  ensureUpstreamConnection(token: string) {
    this.startPolling(token);

    if (this.upstreamConnections.has(token) || this.upstreamPollingOnlyTokens.has(token)) {
      return;
    }

    this.connectToEthol(token);
  }

  private connectToEthol(token: string) {
    this.logger.log('Connecting to ETHOL WebSocket...');

    const ws = new WsClient(ETHOL_WS_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Origin': 'https://ethol.pens.ac.id',
      },
    });

    const connectTimeout = setTimeout(() => {
      conn.expectedPollingFallback = true;
      ws.terminate();
    }, UPSTREAM_CONNECT_TIMEOUT_MS);

    const conn: UpstreamConnection = { ws, token, opened: false, connectTimeout, expectedPollingFallback: false };
    this.upstreamConnections.set(token, conn);

    ws.on('open', () => {
      this.logger.log('Connected to ETHOL WebSocket');
      conn.opened = true;
      clearTimeout(conn.connectTimeout);
      this.upstreamPollingOnlyTokens.delete(token);

      this.notifyTokenClients(token, 'ethol_ws_connected', {
        message: 'Connected to ETHOL real-time server',
      });
    });

    ws.on('message', (raw: Buffer) => {
      const messageStr = raw.toString();
      this.logger.debug(`ETHOL WS message: ${messageStr.substring(0, 200)}`);

      let parsed: unknown;
      try {
        parsed = JSON.parse(messageStr);
      } catch {
        parsed = messageStr;
      }

      this.notifyTokenClients(token, 'ethol_message', parsed);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      clearTimeout(conn.connectTimeout);
      this.upstreamConnections.delete(token);
      this.upstreamPollingOnlyTokens.add(token);

      if (conn.opened) {
        this.logger.warn('ETHOL WS disconnected after opening. Continuing with polling updates only.');
      } else if (!conn.expectedPollingFallback) {
        this.logger.debug(`ETHOL WS closed before opening: ${code} ${reason.toString()}`);
      }

      this.notifyTokenClients(token, 'upstream_ws_unavailable', {
        message: conn.opened
          ? 'ETHOL real-time upstream disconnected. Continuing with polling updates every 5-8 seconds.'
          : `ETHOL real-time upstream did not respond within ${UPSTREAM_CONNECT_TIMEOUT_MS / 1000} seconds. Continuing with polling updates every 5-8 seconds.`,
      });
    });

    ws.on('error', (err: Error) => {
      if (conn.expectedPollingFallback && !conn.opened) {
        return;
      }

      this.logger.debug(`ETHOL WS error: ${err.message}`);
    });
  }

  private notifyTokenClients(token: string, event: string, data: unknown) {
    for (const [client, meta] of this.gateway.getConnectedClients()) {
      if (meta.token === token) {
        this.gateway.sendToClient(client, event, data);
      }
    }
  }

  private startPolling(token: string) {
    if (this.pollIntervals.has(token)) return;

    this.scheduleNextPoll(token);
  }

  private scheduleNextPoll(token: string, delayMs = this.getRandomPollIntervalMs()) {
    const existingTimeout = this.pollIntervals.get(token);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(async () => {
      const hasClients = Array.from(this.gateway.getConnectedClients().values()).some(c => c.token === token);
      if (!hasClients) {
        this.pollIntervals.delete(token);
        this.seenNotifications.delete(token);
        this.upstreamPollingOnlyTokens.delete(token);
        return;
      }

      try {
        await this.pollNotifications(token);
      } finally {
        if (this.gateway.getConnectedClients().size > 0) {
          const stillHasClients = Array.from(this.gateway.getConnectedClients().values()).some(c => c.token === token);
          if (stillHasClients) {
            this.scheduleNextPoll(token);
            return;
          }
        }

        this.pollIntervals.delete(token);
        this.seenNotifications.delete(token);
        this.upstreamPollingOnlyTokens.delete(token);
      }
    }, delayMs);

    this.pollIntervals.set(token, timeout);
  }

  private getRandomPollIntervalMs(): number {
    return MIN_POLL_INTERVAL_MS + Math.floor(Math.random() * (MAX_POLL_INTERVAL_MS - MIN_POLL_INTERVAL_MS + 1));
  }

  private async pollNotifications(token: string) {
    const filters = ['PRESENSI', 'TUGAS', 'MATERI', 'VIDEO'];
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'token': token,
    };

    const allNotifications: Array<{ type: string; data: unknown }> = [];
    const newItems: Array<{ type: string; notification: Record<string, unknown> }> = [];
    const seen = this.seenNotifications.get(token) ?? new Set<string>();
    this.seenNotifications.set(token, seen);

    for (const filter of filters) {
      try {
        const res = await fetch(`${ETHOL_API_BASE}/api/notifikasi/mahasiswa?filterNotif=${filter}`, {
          headers,
          redirect: 'manual',
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          const type = filter.toLowerCase();
          allNotifications.push({ type, data });

          for (const item of this.extractNotificationItems(data)) {
            const notificationId = item.idNotifikasi;
            if (notificationId === undefined || notificationId === null) {
              continue;
            }

            const dedupKey = `${type}:${String(notificationId)}`;
            if (!seen.has(dedupKey)) {
              seen.add(dedupKey);
              newItems.push({ type, notification: item });
            }
          }
        }
      } catch (err) {
        this.logger.debug(`Failed to poll ${filter}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    // Also fetch unread count
    try {
      const countRes = await fetch(`${ETHOL_API_BASE}/api/notifikasi/mahasiswa-belum-baca`, {
        headers,
        redirect: 'manual',
        cache: 'no-store',
      });
      if (countRes.ok) {
        const countData = await countRes.json();
        allNotifications.push({ type: 'unread_count', data: countData });
      }
    } catch {
      // silently skip
    }

    if (allNotifications.length > 0) {
      for (const [client, meta] of this.gateway.getConnectedClients()) {
        if (meta.token === token) {
          this.gateway.sendToClient(client, 'notifications', allNotifications);
        }
      }
    }

    for (const item of newItems) {
      await this.fireWebhook(token, item.type, item.notification);

      const nim = this.extractNimFromToken(token);
      if (!nim) {
        this.logger.debug('Incremental sync skipped: unable to extract nim from token');
        continue;
      }

      await this.syncService.incrementalSync(nim, item.type, item.notification);
    }
  }

  async fetchAndSendNotifications(token: string, client: WebSocket) {
    const filters = ['PRESENSI', 'TUGAS', 'MATERI', 'VIDEO'];
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'token': token,
    };

    const allNotifications: Array<{ type: string; data: unknown }> = [];
    const seen = this.seenNotifications.get(token) ?? new Set<string>();
    this.seenNotifications.set(token, seen);

    for (const filter of filters) {
      try {
        const res = await fetch(`${ETHOL_API_BASE}/api/notifikasi/mahasiswa?filterNotif=${filter}`, {
          headers,
          redirect: 'manual',
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          const type = filter.toLowerCase();
          allNotifications.push({ type, data });

          for (const item of this.extractNotificationItems(data)) {
            const notificationId = item.idNotifikasi;
            if (notificationId === undefined || notificationId === null) {
              continue;
            }

            seen.add(`${type}:${String(notificationId)}`);
          }
        }
      } catch {
        // silently skip failed fetches
      }
    }

    // Also fetch unread count
    try {
      const countRes = await fetch(`${ETHOL_API_BASE}/api/notifikasi/mahasiswa-belum-baca`, {
        headers,
        redirect: 'manual',
        cache: 'no-store',
      });
      if (countRes.ok) {
        const countData = await countRes.json();
        allNotifications.push({ type: 'unread_count', data: countData });
      }
    } catch {
      // silently skip
    }

    this.gateway.sendToClient(client, 'notifications', allNotifications);
  }

  private extractNotificationItems(data: unknown): Record<string, unknown>[] {
    if (Array.isArray(data)) {
      return data.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    }

    if (typeof data !== 'object' || data === null) {
      return [];
    }

    const record = data as Record<string, unknown>;
    if ('idNotifikasi' in record) {
      return [record];
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
      }
    }

    return [];
  }

  private async fireWebhook(token: string, type: string, notification: Record<string, unknown>) {
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL ?? 'http://127.0.0.1:3005/webhook';

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: 'new_notification',
          type,
          token,
          data: notification,
        }),
      });

      if (!response.ok) {
        this.logger.debug(`Webhook request failed (${response.status} ${response.statusText}) for ${type}`);
      }
    } catch (err) {
      this.logger.debug(`Webhook request error for ${type}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  private decodeTokenPayload(token: string): Record<string, unknown> | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;

      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64').toString('utf-8');
      return JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private extractNimFromToken(token: string): string | null {
    const parsed = this.decodeTokenPayload(token);
    const nimRaw = parsed?.nipnrp ?? parsed?.nomor;

    if (typeof nimRaw === 'string' || typeof nimRaw === 'number') {
      return String(nimRaw);
    }

    return null;
  }

  private extractDataTerkait(notification: Record<string, unknown>): unknown {
    return (
      notification.dataTerkait ??
      notification.nomorTugas ??
      notification.idTugas ??
      notification.nomor ??
      notification.id
    );
  }
}
