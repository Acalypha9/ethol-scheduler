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
- `deploy/nginx/default.conf` - reverse proxy for frontend, `/api`, and `/ws`
- `scripts/aws/bootstrap-ec2.sh` - one-time EC2 host setup
- `scripts/aws/deploy-ec2.sh` - pull/build/up deployment script
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

## 3. Deploy automatically from GitHub Actions

Add these repository secrets:

- `AWS_EC2_HOST`
- `AWS_EC2_USER`
- `AWS_EC2_SSH_KEY`

Then pushing to `master` or running the workflow manually will:

1. copy the repo to `/opt/ethol-scheduler`
2. run `scripts/aws/deploy-ec2.sh`

## 4. Ports and routing

- `nginx` listens on port `80`
- `/` -> frontend container
- `/api/*` -> backend container
- `/ws/*` -> backend WebSocket endpoint
- WhatsApp bot is internal-only unless you explicitly expose it

## 5. Persistence

The Compose stack stores WhatsApp session data in Docker volumes:

- `wa_auth`
- `wa_cache`

Keep your EC2 instance on persistent EBS storage and snapshot it regularly.

## 6. Recommended AWS services

- EC2 for app runtime
- RDS PostgreSQL for `DATABASE_URL`
- Route 53 + your domain for public routing
- ACM + ALB or CloudFront only if you later want managed TLS in front of EC2

For the current project, plain EC2 + Docker Compose is the simplest reliable starting point.
