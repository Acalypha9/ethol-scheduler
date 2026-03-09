# AWS Deployment

This project is easiest to deploy on a single EC2 instance with Docker Compose.

## Why this shape

- The backend exposes HTTP APIs and a WebSocket endpoint
- The WhatsApp bot needs persistent `.wwebjs_auth` session storage and a local Chromium-compatible browser
- A single EC2 host keeps those services on one machine with simple networking and persistent storage

## Files used for deployment

- `backend/Dockerfile` - backend image
- `wa-bot/Dockerfile` - bot image
- `deploy/docker-compose.aws.yml` - production compose stack
- `deploy/nginx/default.conf` - HTTP nginx template with ACME support
- `deploy/nginx/default.ssl.conf` - HTTPS nginx template
- `deploy/nginx/entrypoint.sh` - selects HTTP-only vs HTTPS mode
- `scripts/aws/bootstrap-ec2.sh` - one-time EC2 bootstrap
- `scripts/aws/deploy-ec2.sh` - pull/build/up deployment script
- `scripts/aws/setup-letsencrypt.sh` - initial certificate issuance
- `scripts/aws/renew-letsencrypt.sh` - certificate renewal
- `scripts/aws/install-letsencrypt-renewal.sh` - installs renewal cron

## 1. EC2 bootstrap

```bash
git clone <your-repo-url> /opt/ethol-scheduler
cd /opt/ethol-scheduler
bash scripts/aws/bootstrap-ec2.sh
```

Then fill these files:

- `/opt/ethol-scheduler/backend/.env`
- `/opt/ethol-scheduler/wa-bot/.env`

## 2. Deploy manually on EC2

```bash
cd /opt/ethol-scheduler
bash scripts/aws/deploy-ec2.sh
```

After the stack is up, log in to ETHOL once through the backend so it can persist the session and trigger the initial sync:

```bash
curl -X POST http://127.0.0.1/api/login \
  -H "Host: <primary-domain>" \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_ETHOL_EMAIL","password":"YOUR_ETHOL_PASSWORD"}'
```

Then watch for `Bootstrap sync completed` in backend logs:

```bash
docker compose -f deploy/docker-compose.aws.yml logs -f backend
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

1. starts the Docker stack in HTTP mode
2. verifies the ACME challenge path locally and publicly before requesting a certificate
3. requests a real Let's Encrypt certificate for:
   - `<primary-domain>`
   - `<bot-domain>`
4. links the live certificate into a generic path used by nginx
5. restarts nginx in HTTPS mode

Test safely against staging first if needed:

```bash
STAGING=1 bash scripts/aws/setup-letsencrypt.sh <primary-domain> <bot-domain> <email>
```

Install automatic renewal:

```bash
bash scripts/aws/install-letsencrypt-renewal.sh <primary-domain>
```

## 4. GitHub Actions deployment

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
- the default host routes `/`, `/api/*`, and `/ws/*` to the backend
- any host starting with `whatsapp.` routes to the WhatsApp bot container

## 6. Persistence

The Compose stack stores WhatsApp session data in Docker volumes:

- `wa_auth`
- `wa_cache`

The backend ETHOL session is also stored in a Docker volume:

- `backend_auth`

Keep your EC2 instance on persistent EBS storage and snapshot it regularly.

Let's Encrypt runtime data is stored under:

- `deploy/letsencrypt/conf`
- `deploy/letsencrypt/live`
- `deploy/letsencrypt/www`

## 7. Recommended AWS services

- EC2 for app runtime
- RDS PostgreSQL for `DATABASE_URL`
- Cloudflare or any DNS provider for public routing

For the current backend + WhatsApp bot project, plain EC2 + Docker Compose with Let's Encrypt is the simplest reliable starting point.

## 8. RDS TLS

The backend image includes the AWS RDS CA bundle at:

- `/etc/ssl/certs/aws-rds-global-bundle.pem`

Recommended `DATABASE_URL` format:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public&sslmode=require
DATABASE_SSL_CA_PATH=/etc/ssl/certs/aws-rds-global-bundle.pem
```

If you are still diagnosing certificate issues temporarily, you can allow invalid certs only as a last resort:

```env
DATABASE_SSL_ACCEPT_INVALID_CERTS=true
```

Do not leave that enabled once the CA-based connection works.
