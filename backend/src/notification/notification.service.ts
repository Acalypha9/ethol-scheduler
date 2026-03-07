import { Injectable, Logger, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { WebSocket as WsClient } from 'ws';
import { NotificationGateway } from './notification.gateway';
import type { WebSocket } from 'ws';
import { SyncService } from '../sync/sync.service';

const ETHOL_WS_URL = 'wss://chat.ethol.pens.ac.id/socket';
const ETHOL_API_BASE = 'https://ethol.pens.ac.id';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const POLL_INTERVAL_MS = process.env.POLL_INTERVAL_MS ? parseInt(process.env.POLL_INTERVAL_MS) : 10_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface UpstreamConnection {
  ws: WsClient;
  token: string;
  reconnectAttempts: number;
}

@Injectable()
export class NotificationService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private upstreamConnections = new Map<string, UpstreamConnection>();
  private pollIntervals = new Map<string, NodeJS.Timeout>();
  private seenNotifications = new Map<string, Set<string>>();

  constructor(
    @Inject(forwardRef(() => NotificationGateway)) private readonly gateway: NotificationGateway,
    private readonly syncService: SyncService,
  ) {}

  onModuleDestroy() {
    // Clean up all upstream connections and intervals
    for (const [, conn] of this.upstreamConnections) {
      conn.ws.close();
    }
    for (const [, interval] of this.pollIntervals) {
      clearInterval(interval);
    }
  }

  ensureUpstreamConnection(token: string) {
    if (this.upstreamConnections.has(token)) return;
    this.connectToEthol(token);
    this.startPolling(token);
  }

  private connectToEthol(token: string, attempt = 0) {
    this.logger.log(`Connecting to ETHOL WebSocket${attempt > 0 ? ` (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS})` : ''}...`);

    const ws = new WsClient(ETHOL_WS_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Origin': 'https://ethol.pens.ac.id',
      },
    });

    const conn: UpstreamConnection = { ws, token, reconnectAttempts: attempt };
    this.upstreamConnections.set(token, conn);

    ws.on('open', () => {
      this.logger.log('Connected to ETHOL WebSocket');
      conn.reconnectAttempts = 0;

      // Send auth token to ETHOL WS (ETHOL may expect token as first message)
      ws.send(JSON.stringify({ token }));

      this.gateway.broadcastToAll('ethol_ws_connected', {
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

      // Forward to all connected downstream clients
      this.gateway.broadcastToAll('ethol_message', parsed);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.logger.warn(`ETHOL WS closed: ${code} ${reason.toString()}`);
      this.upstreamConnections.delete(token);

      const nextAttempt = conn.reconnectAttempts + 1;
      if (nextAttempt <= MAX_RECONNECT_ATTEMPTS) {
        setTimeout(() => {
          const hasClients = Array.from(this.gateway.getConnectedClients().values()).some(c => c.token === token);
          if (hasClients) {
            this.connectToEthol(token, nextAttempt);
          }
        }, RECONNECT_DELAY_MS);
      } else {
        this.logger.warn('ETHOL WS: max reconnect attempts reached. Upstream WS disabled (REST polling still active).');
      }
    });

    ws.on('error', (err: Error) => {
      this.logger.debug(`ETHOL WS error: ${err.message}`);
    });
  }

  private startPolling(token: string) {
    if (this.pollIntervals.has(token)) return;

    // Polling starts after first interval (initial fetch handled by fetchAndSendNotifications)

    // Then poll periodically
    const interval = setInterval(() => {
      const hasClients = Array.from(this.gateway.getConnectedClients().values()).some(c => c.token === token);
      if (!hasClients) {
        clearInterval(interval);
        this.pollIntervals.delete(token);
        this.seenNotifications.delete(token);
        return;
      }
      this.pollNotifications(token);
    }, POLL_INTERVAL_MS);

    this.pollIntervals.set(token, interval);
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
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL ?? 'http://localhost:3005/webhook';

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
