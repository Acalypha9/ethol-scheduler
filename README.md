# ETHOL Backend + WhatsApp Bot

This repository contains the ETHOL backend API and the WhatsApp bot only.

## Services

### Backend

- Stack: NestJS + Prisma
- Location: `backend/`
- Default local URL: `http://localhost:4000`
- Global API prefix: `/api`
- WebSocket endpoint: `ws://localhost:4000/ws/notifications`

### WhatsApp Bot

- Stack: Node.js + `whatsapp-web.js`
- Location: `wa-bot/`
- Default local URL: `http://localhost:3005`
- Webhook endpoint: `POST /webhook`
- Health endpoint: `GET /health`
- Default mode: headless

## Backend Endpoints

Implemented in `backend/src/ethol/ethol.controller.ts`.

### Session

- `POST /api/login`
- `POST /api/logout`
- `GET /api/token`

### ETHOL Data

- `GET /api/schedule`
- `GET /api/homework`
- `GET /api/attendance`

### ETHOL Proxy

- `GET /api/proxy/*path`
- `POST /api/proxy/*path`
- `PUT /api/proxy/*path`
- `DELETE /api/proxy/*path`

### MIS Schedule

- `GET /api/mis-schedule?tahun=<number>&semester=<number>`

### Root Status

- `GET /`
- `GET /health`

## WebSocket

Backend notifications are exposed at:

- `ws://localhost:4000/ws/notifications?token=<jwt>`

Events include:

- `connected`
- `notifications`
- `ethol_message`
- `ethol_ws_connected`
- `upstream_ws_unavailable`
- `refresh_complete`
- `error`

If the upstream ETHOL socket does not open within 5 seconds, the backend falls back to polling-only updates every 5-8 seconds.

## WhatsApp Bot Behavior

Main file:

- `wa-bot/whatsapp-bot.js`

Features:

- consumes backend REST endpoints
- consumes backend WebSocket notifications
- supports dynamic group delivery by default
- sends notifications to every joined group unless `TARGET_CHAT_ID` is set to a real chat id

Commands:

- `/help`
- `/today`
- `/schedule`
- `/task`
- `/task y{N} s{N}`
- `/materi`

## Local Development

### Backend

```bash
cd backend
npm install
npx prisma generate
npm run start:dev
```

### WhatsApp Bot

```bash
cd wa-bot
npm install
node whatsapp-bot.js
```

## Deployment

The deployment stack in `deploy/` is built for:

- primary domain -> backend
- `whatsapp.<your-domain>` -> WhatsApp bot
- EC2 + nginx + Let's Encrypt

Notes:

- backend auth is persisted in a Docker volume and reused across restarts
- a successful `/api/login` now triggers the initial ETHOL bootstrap sync immediately
- WhatsApp session data is persisted in Docker volumes too

See `deploy/AWS-DEPLOYMENT.md` for the full deploy guide.

## Local Runtime Files

- `auth.json`
- `backend/auth.json`
- `wa-bot/.wwebjs_auth/`
- `wa-bot/.wwebjs_cache/`

These should stay local and are ignored by git.
