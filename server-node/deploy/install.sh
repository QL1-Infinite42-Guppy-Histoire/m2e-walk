#!/usr/bin/env bash
# M2E Walk points server — installer for Ubuntu 24.04 (VPS).
#
# What it does:
#   1. Installs Node.js 24 (NodeSource) if missing/too old — node:sqlite
#      requires Node >= 22.5, and Node 24 needs no experimental flag.
#   2. Creates the unprivileged user "m2e" and /opt/m2e-walk.
#   3. Copies this repository's server-node/ into /opt/m2e-walk/server-node.
#   4. Creates /opt/m2e-walk/.env from .env.example if absent (chmod 600).
#      YOU must fill in ADMIN_SECRET and GIFT_CODE_KEY afterwards —
#      the service refuses to be useful for /admin/* without them.
#   5. Installs the systemd unit and enables it.
#   6. Optionally (--with-caddy <domain>) installs Caddy and writes a
#      reverse-proxy site with automatic HTTPS for that domain.
#
# It does NOT touch any other service on the box (the box is shared with
# the CAW node — this server uses its own directory, user and port 8787).
#
# Usage:
#   sudo bash deploy/install.sh [--with-caddy walk.example.com]
# Re-running is safe: code is refreshed, .env and data/ are preserved.
set -euo pipefail

DOMAIN=""
if [[ "${1:-}" == "--with-caddy" ]]; then
  DOMAIN="${2:?--with-caddy needs a domain name}"
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_HOME="/opt/m2e-walk"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/install.sh" >&2
  exit 1
fi

echo "==> Node.js"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$MAJOR" -ge 24 ]] && NODE_OK=1
fi
if [[ "$NODE_OK" -eq 0 ]]; then
  echo "    Installing Node.js 24 from NodeSource..."
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> User and directories"
id m2e >/dev/null 2>&1 || useradd --system --home-dir "$APP_HOME" --shell /usr/sbin/nologin m2e
mkdir -p "$APP_HOME/server-node" "$APP_HOME/data" "$APP_HOME/backups"

echo "==> Application files"
# Copy code only — never overwrite .env, data/ or backups/.
( cd "$SRC_DIR" && tar cf - --exclude=data --exclude=.env --exclude=node_modules . ) \
  | ( cd "$APP_HOME/server-node" && tar xf - )

if [[ ! -f "$APP_HOME/.env" ]]; then
  cp "$APP_HOME/server-node/.env.example" "$APP_HOME/.env"
  chmod 600 "$APP_HOME/.env"
  echo "    Created $APP_HOME/.env from the example — EDIT IT before starting:"
  echo "      ADMIN_SECRET and GIFT_CODE_KEY are still empty."
fi
chown -R m2e:m2e "$APP_HOME"
chmod 600 "$APP_HOME/.env"

echo "==> systemd"
cp "$APP_HOME/server-node/deploy/m2e-walk.service" /etc/systemd/system/m2e-walk.service
systemctl daemon-reload
systemctl enable m2e-walk

if grep -q '^ADMIN_SECRET=.\+' "$APP_HOME/.env" && grep -q '^GIFT_CODE_KEY=.\+' "$APP_HOME/.env"; then
  systemctl restart m2e-walk
  echo "    Service started. Check: systemctl status m2e-walk"
  echo "    Health:  curl http://127.0.0.1:8787/health"
else
  echo "    Service enabled but NOT started: fill in $APP_HOME/.env first, then:"
  echo "      sudo systemctl start m2e-walk"
fi

if [[ -n "$DOMAIN" ]]; then
  echo "==> Caddy (HTTPS for $DOMAIN)"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
  sed "s/walk.example.com/$DOMAIN/" "$APP_HOME/server-node/deploy/Caddyfile.example" > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
  echo "    Caddy configured. Once DNS for $DOMAIN points at this box,"
  echo "    https://$DOMAIN/health should answer {\"ok\":true,...}."
fi

echo "Done."
