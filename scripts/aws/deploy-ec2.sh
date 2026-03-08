#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ethol-scheduler}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
ECR_REGISTRY="${ECR_REGISTRY:-}"
GIT_REF="${GIT_REF:-master}"

cd "$APP_DIR"

if [[ -d .git ]]; then
  git fetch --all --prune
  git checkout "$GIT_REF"
  git pull --ff-only origin "$GIT_REF"
fi

if [[ -n "$ECR_REGISTRY" ]]; then
  aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
fi

docker compose -f deploy/docker-compose.aws.yml pull --ignore-buildable || true
docker compose -f deploy/docker-compose.aws.yml build
docker compose -f deploy/docker-compose.aws.yml up -d --remove-orphans
docker image prune -f

echo "Deployment complete."
