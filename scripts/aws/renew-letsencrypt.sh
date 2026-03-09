#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ethol-scheduler}"
CERT_NAME="${1:-${CERT_NAME:-}}"

if [[ -z "$CERT_NAME" ]]; then
  echo "Usage: bash scripts/aws/renew-letsencrypt.sh <cert-name>"
  exit 1
fi

cd "$APP_DIR"

docker compose -f deploy/docker-compose.aws.yml run --rm certbot renew --webroot -w /var/www/certbot

ln -sfn "../conf/live/$CERT_NAME/fullchain.pem" deploy/letsencrypt/live/fullchain.pem
ln -sfn "../conf/live/$CERT_NAME/privkey.pem" deploy/letsencrypt/live/privkey.pem

docker compose -f deploy/docker-compose.aws.yml restart nginx

echo "Let's Encrypt renewal complete for cert: $CERT_NAME"
