# AWS Deployment

This project is easiest to deploy on a single EC2 instance with Docker Compose.

## Why this shape

- The Next.js frontend proxies to the Nest backend
- The backend exposes HTTP APIs and a WebSocket endpoint
- The WhatsApp bot needs persistent `.wwebjs_auth` session storage and a local Chromium binary
- A single EC2 host keeps those services on one machine with simple networking and persistent storage

## Files added for deployment

- `Dockerfile` - frontend image
- `backend/Dockerfile` - backend image
- `wa-bot/Dockerfile` - bot image with Chromium
- `deploy/docker-compose.aws.yml` - production compose stack
- `deploy/nginx/default.conf` - HTTP nginx template with ACME challenge support
- `deploy/nginx/default.ssl.conf` - HTTPS nginx template
- `deploy/nginx/entrypoint.sh` - switches nginx between HTTP-only and HTTPS mode based on cert presence
- `scripts/aws/bootstrap-ec2.sh` - one-time EC2 host setup
- `scripts/aws/deploy-ec2.sh` - pull/build/up deployment script
- `scripts/aws/setup-letsencrypt.sh` - initial Let's Encrypt certificate issuance
- `scripts/aws/renew-letsencrypt.sh` - certificate renewal script
- `scripts/aws/install-letsencrypt-renewal.sh` - installs a cron job for renewal
- `.github/workflows/deploy-aws-ec2.yml` - optional push-based deploy via SSH

## 1. EC2 bootstrap

On a new Ubuntu EC2 instance:

```bash
git clone <your-repo-url> /opt/ethol-scheduler
cd /opt/ethol-scheduler
bash scripts/aws/bootstrap-ec2.sh
```

Then fill these files:

- `/opt/ethol-scheduler/.env`
- `/opt/ethol-scheduler/backend/.env`
- `/opt/ethol-scheduler/wa-bot/.env`

## 2. Deploy manually on EC2

```bash
cd /opt/ethol-scheduler
bash scripts/aws/deploy-ec2.sh
```

## 3. Enable HTTPS with Let's Encrypt

After the first deploy, request certificates with:

```bash
bash scripts/aws/setup-letsencrypt.sh <primary-domain> <bot-domain> <email>
```

Example:

```bash
bash scripts/aws/setup-letsencrypt.sh example.com whatsapp.example.com you@example.com
```

This script:

1. creates temporary dummy certificates so nginx can boot
2. starts the Docker stack
3. requests a real Let's Encrypt certificate for:
   - `<primary-domain>`
   - `www.<primary-domain>`
   - `<bot-domain>`
4. links the live certificate into a generic path used by nginx
5. restarts nginx in HTTPS mode

To test safely against Let's Encrypt staging first:

```bash
STAGING=1 bash scripts/aws/setup-letsencrypt.sh <primary-domain> <bot-domain> <email>
```

Install automatic renewal:

```bash
bash scripts/aws/install-letsencrypt-renewal.sh <primary-domain>
```

## 4. Deploy automatically from GitHub Actions

Add these repository secrets:

- `AWS_EC2_HOST`
- `AWS_EC2_USER`
- `AWS_EC2_SSH_KEY`

Then pushing to `master` or running the workflow manually will:

1. copy the repo to `/opt/ethol-scheduler`
2. run `scripts/aws/deploy-ec2.sh`

## 5. Ports and routing

- `nginx` listens on ports `80` and `443`
- `/.well-known/acme-challenge/*` is served for Let's Encrypt HTTP-01 validation
- the default host routes `/` -> frontend, `/api/*` -> backend, and `/ws/*` -> backend WebSocket
- any host starting with `whatsapp.` routes to the WhatsApp bot container

## 6. Persistence

The Compose stack stores WhatsApp session data in Docker volumes:

- `wa_auth`
- `wa_cache`

Keep your EC2 instance on persistent EBS storage and snapshot it regularly.

Let's Encrypt runtime data is stored under:

- `deploy/letsencrypt/conf`
- `deploy/letsencrypt/live`
- `deploy/letsencrypt/www`

## 7. Recommended AWS services

- EC2 for app runtime
- RDS PostgreSQL for `DATABASE_URL`
- Route 53 or any DNS provider for public routing

For the current project, plain EC2 + Docker Compose with Let's Encrypt is the simplest reliable starting point.
