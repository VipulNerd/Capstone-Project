#!/usr/bin/env bash
# Deploy the committed code (git HEAD) to the MinutesAI VM and restart the stack.
#
#   deploy/vm/deploy.sh azureuser@<vm-dns-name>
#
# Run from the repo root (Git Bash on Windows, or Linux/macOS, or GitHub Actions).
# Needs SSH access to the VM and /opt/mom/.env already on the VM (see deploy/vm/README.md).
# Only committed files are uploaded (git archive): local .env files and node_modules never leave the PC.
# Extra ssh options (e.g. a key file) can be passed in SSH_OPTS="-i ~/.ssh/mom_vm".
set -euo pipefail

TARGET="${1:?usage: deploy/vm/deploy.sh user@host}"
SSH_OPTS="${SSH_OPTS:-}"
# shellcheck disable=SC2086
ssh_vm() { ssh $SSH_OPTS -o BatchMode=yes "$TARGET" "$@"; }

cd "$(git rev-parse --show-toplevel)"
REV="$(git rev-parse --short=12 HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  echo "Note: uncommitted changes are NOT deployed; deploying commit $REV."
fi

echo "==> Uploading $REV"
git archive --format=tar HEAD | ssh_vm 'set -e; rm -rf /opt/mom/app.new; mkdir -p /opt/mom/app.new; tar -x -C /opt/mom/app.new'

echo "==> Switching to the new code, building and starting"
ssh_vm "REV=$REV bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/mom
[ -f .env ] || { echo "ERROR: /opt/mom/.env is missing (copy deploy/vm/.env.example, fill it in, chmod 600)"; exit 1; }
rm -rf app.old
[ -d app ] && mv app app.old
mv app.new app
ln -sf /opt/mom/.env app/deploy/vm/.env
echo "$REV" > app/REVISION

cd app/deploy/vm
docker compose up -d --build --remove-orphans

echo "Waiting for the backend to become healthy (migrations run on start)..."
for i in $(seq 1 60); do
  state=$(docker compose ps backend --format '{{.Health}}' 2>/dev/null || true)
  [ "$state" = "healthy" ] && break
  sleep 5
done
if [ "$state" != "healthy" ]; then
  echo "ERROR: backend not healthy ($state). Last logs:"
  docker compose logs --tail 60 backend
  exit 1
fi
docker compose ps
docker image prune -f >/dev/null
REMOTE

DOMAIN="$(ssh_vm "grep -E '^SITE_DOMAIN=' /opt/mom/.env | cut -d= -f2-")"
echo "==> Checking https://$DOMAIN/api/health"
for i in $(seq 1 24); do
  body="$(curl -s --max-time 10 "https://$DOMAIN/api/health" || true)"
  if echo "$body" | grep -q '"database":true'; then
    echo "Deployed $REV -> https://$DOMAIN"
    exit 0
  fi
  sleep 5
done
echo "ERROR: https://$DOMAIN/api/health did not report a healthy database. Got: $body"
exit 1
