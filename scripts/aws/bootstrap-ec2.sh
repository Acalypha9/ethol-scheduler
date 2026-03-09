#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ethol-scheduler}"
APP_USER="${APP_USER:-ubuntu}"
APP_GROUP="${APP_GROUP:-ubuntu}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"

sudo apt-get update
sudo apt-get install -y ca-certificates curl git unzip cron openssl

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi

sudo usermod -aG docker "$APP_USER"

sudo mkdir -p /usr/local/lib/docker/cli-plugins
if ! docker compose version >/dev/null 2>&1; then
  sudo curl -SL "https://github.com/docker/compose/releases/download/v2.35.1/docker-compose-linux-x86_64" -o /usr/local/lib/docker/cli-plugins/docker-compose
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

if ! command -v aws >/dev/null 2>&1; then
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  rm -rf /tmp/aws
  unzip -q /tmp/awscliv2.zip -d /tmp
  sudo /tmp/aws/install --update
fi

sudo mkdir -p "$APP_DIR"
sudo chown -R "$APP_USER":"$APP_GROUP" "$APP_DIR"

sudo systemctl enable --now cron

for file in "backend/.env" "wa-bot/.env"; do
  target="$APP_DIR/$file"
  if [[ ! -f "$target" ]]; then
    mkdir -p "$(dirname "$target")"
    cp "$APP_DIR/${file}.example" "$target"
  fi
done

cat <<EOF
Bootstrap complete.

Next steps:
1. Put the repository at $APP_DIR
2. Fill these files with production values:
   - $APP_DIR/backend/.env
   - $APP_DIR/wa-bot/.env
3. Run the deploy script, then the Let's Encrypt setup script
4. Optional: run 'aws configure set region $AWS_REGION' if you will pull from ECR
EOF
