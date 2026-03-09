#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ethol-scheduler}"
CERT_NAME="${1:-${CERT_NAME:-}}"
CRON_SCHEDULE="${CRON_SCHEDULE:-19 3 * * *}"
LOG_FILE="${LOG_FILE:-/var/log/letsencrypt-renew.log}"

if [[ -z "$CERT_NAME" ]]; then
  echo "Usage: bash scripts/aws/install-letsencrypt-renewal.sh <cert-name>"
  exit 1
fi

CRON_CMD="cd $APP_DIR && CERT_NAME='$CERT_NAME' bash scripts/aws/renew-letsencrypt.sh '$CERT_NAME' >> '$LOG_FILE' 2>&1"

(crontab -l 2>/dev/null | grep -Fv "$CRON_CMD"; echo "$CRON_SCHEDULE $CRON_CMD") | crontab -

echo "Installed renewal cron: $CRON_SCHEDULE"
