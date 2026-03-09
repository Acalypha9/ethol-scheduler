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

mkdir -p deploy/letsencrypt/conf deploy/letsencrypt/live

docker compose -f deploy/docker-compose.aws.yml up -d backend wa-bot nginx

probe_token="acme-preflight-$(date +%s)"
probe_body="acme-ok-${probe_token}"
docker compose -f deploy/docker-compose.aws.yml run --rm --entrypoint sh certbot -c "mkdir -p /var/www/certbot/.well-known/acme-challenge && printf '%s' '$probe_body' > /var/www/certbot/.well-known/acme-challenge/$probe_token"
trap 'docker compose -f deploy/docker-compose.aws.yml run --rm --entrypoint sh certbot -c "rm -f /var/www/certbot/.well-known/acme-challenge/$probe_token" >/dev/null 2>&1 || true' EXIT

for host in "$PRIMARY_DOMAIN" "$BOT_DOMAIN"; do
  local_response="$(curl -fsS --retry 10 --retry-connrefused --retry-delay 1 -H "Host: $host" "http://127.0.0.1/.well-known/acme-challenge/${probe_token}")"
  if [[ "$local_response" != "$probe_body" ]]; then
    echo "Local ACME preflight failed for $host"
    echo "Expected: $probe_body"
    echo "Received: $local_response"
    exit 1
  fi

  public_response="$(curl -fsS --retry 5 --retry-delay 2 --connect-timeout 10 "http://${host}/.well-known/acme-challenge/${probe_token}")"
  if [[ "$public_response" != "$probe_body" ]]; then
    echo "Public ACME preflight failed for $host"
    echo "Expected: $probe_body"
    echo "Received: $public_response"
    echo "Check that DNS points to this EC2 host, Cloudflare is set to DNS only, and port 80 is open."
    exit 1
  fi
done

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
