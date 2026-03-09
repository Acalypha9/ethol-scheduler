import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT || '4000');
  const host = process.env.HOST || '0.0.0.0';
  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
  const websocketBaseUrl = process.env.PUBLIC_WS_BASE_URL || publicBaseUrl.replace(/^http/i, 'ws');

  app.setGlobalPrefix('api');

  app.useWebSocketAdapter(new WsAdapter(app));

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const httpServer = app.getHttpAdapter().getInstance();
  httpServer.get('/', (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json({
      ok: true,
      service: 'ethol-scheduler-backend',
      apiBase: '/api',
      websocketPath: '/ws/notifications',
    });
  });
  httpServer.get('/health', (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json({ ok: true, service: 'ethol-scheduler-backend' });
  });

  await app.listen(port, host);
  console.log(`NestJS backend running on ${publicBaseUrl}`);
  console.log(`WebSocket endpoint: ${websocketBaseUrl}/ws/notifications`);
}
bootstrap();
