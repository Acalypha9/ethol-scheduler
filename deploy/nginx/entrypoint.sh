#!/usr/bin/env sh
set -eu

HTTP_TEMPLATE="/etc/nginx/templates/default-http.conf"
SSL_TEMPLATE="/etc/nginx/templates/default-ssl.conf"
TARGET_CONFIG="/etc/nginx/conf.d/default.conf"

if [ -f /etc/nginx/certs/fullchain.pem ] && [ -f /etc/nginx/certs/privkey.pem ]; then
  cp "$SSL_TEMPLATE" "$TARGET_CONFIG"
else
  cp "$HTTP_TEMPLATE" "$TARGET_CONFIG"
fi

exec nginx -g 'daemon off;'
