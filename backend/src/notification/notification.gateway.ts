import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { NotificationService } from './notification.service';

@WebSocketGateway({ path: '/ws/notifications' })
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);
  private clients = new Map<WebSocket, { token: string; connectedAt: Date }>();

  constructor(@Inject(forwardRef(() => NotificationService)) private readonly notificationService: NotificationService) {}

  handleConnection(client: WebSocket, req: IncomingMessage) {
    // Extract token from query: ws://localhost:4000/ws/notifications?token=JWT
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      client.send(JSON.stringify({ type: 'error', message: 'Missing token query parameter. Connect with ?token=YOUR_JWT' }));
      client.close(4001, 'Missing token');
      return;
    }

    this.clients.set(client, { token, connectedAt: new Date() });
    this.logger.log(`Client connected (total: ${this.clients.size})`);

    // Send welcome message
    client.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to ETHOL Notification Gateway',
      timestamp: new Date().toISOString(),
    }));

    // Connect upstream ETHOL WebSocket for this token if not already connected
    this.notificationService.ensureUpstreamConnection(token);

    // Send initial notification list
    this.notificationService.fetchAndSendNotifications(token, client).catch((error) => {
      this.sendToClient(client, 'error', {
        message: 'Failed to fetch initial notifications',
      });
      this.logger.debug(
        `Failed to fetch initial notifications: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });

    client.on('message', async (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string };

        if (message.type !== 'refresh') {
          return;
        }

        this.notificationService.ensureUpstreamConnection(token);
        await this.notificationService.fetchAndSendNotifications(token, client);
        this.sendToClient(client, 'refresh_complete', {
          message: 'Notifications refreshed',
        });
      } catch (error) {
        this.sendToClient(client, 'error', {
          message: 'Failed to refresh notifications',
        });
        this.logger.debug(
          `Failed to process client notification message: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    });
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
    this.logger.log(`Client disconnected (total: ${this.clients.size})`);
  }

  // Called by NotificationService to broadcast to all clients
  broadcastToAll(event: string, data: unknown) {
    const message = JSON.stringify({ type: event, data, timestamp: new Date().toISOString() });
    for (const [client] of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  // Called by NotificationService to send to a specific client
  sendToClient(client: WebSocket, event: string, data: unknown) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: event, data, timestamp: new Date().toISOString() }));
    }
  }

  getConnectedClients(): Map<WebSocket, { token: string; connectedAt: Date }> {
    return this.clients;
  }
}
