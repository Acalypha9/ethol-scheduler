#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ethol-scheduler}"
PRIMARY_DOMAIN="${1:-${PRIMARY_DOMAIN:-}}"
BOT_DOMAIN="${2:-${BOT_DOMAIN:-}}"
LETSENCRYPT_EMAIL="${3:-${LETSENCRYPT_EMAIL:-}}"
CERT_NAME="${CERT_NAME:-${PRIMARY_DOMAIN}}"
STAGING="${STAGING:-0}"

if [[ -z "$PRIMARY_DOMAIN" || -z "$BOT_DOMAIN" || -z "$LETSENCRYPT_EMAIL" ]]; then
  echo "Usage: bash scripts/aws/setup-letsencrypt.sh <primary-domain> <bot-domain> <email>"
  exit 1
fi

cd "$APP_DIR"

mkdir -p deploy/letsencrypt/conf deploy/letsencrypt/live deploy/letsencrypt/www

openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout deploy/letsencrypt/live/privkey.pem \
  -out deploy/letsencrypt/live/fullchain.pem \
  -subj "/CN=localhost"

docker compose -f deploy/docker-compose.aws.yml up -d backend wa-bot nginx

rm -f deploy/letsencrypt/live/fullchain.pem deploy/letsencrypt/live/privkey.pem

staging_arg=""
if [[ "$STAGING" == "1" ]]; then
  staging_arg="--staging"
fi

docker compose -f deploy/docker-compose.aws.yml run --rm certbot certonly \
  --webroot \
  -w /var/www/certbot \
  $staging_arg \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  --cert-name "$CERT_NAME" \
  -d "$PRIMARY_DOMAIN" \
  -d "$BOT_DOMAIN"

ln -sfn "../conf/live/$CERT_NAME/fullchain.pem" deploy/letsencrypt/live/fullchain.pem
ln -sfn "../conf/live/$CERT_NAME/privkey.pem" deploy/letsencrypt/live/privkey.pem

docker compose -f deploy/docker-compose.aws.yml restart nginx

echo "Let's Encrypt setup complete for: $PRIMARY_DOMAIN, $BOT_DOMAIN"
