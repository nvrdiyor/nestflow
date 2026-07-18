#!/usr/bin/env bash
# NestFlow VPS bootstrap — run as root on a fresh Ubuntu/Debian server.
#
#   IP-only (http://SERVER_IP):
#     curl -fsSL https://raw.githubusercontent.com/nvrdiyor/nestflow/main/deploy/vps-bootstrap.sh | bash
#
#   With a domain (requires the domain's DNS A record to point at THIS server):
#     curl -fsSL https://raw.githubusercontent.com/nvrdiyor/nestflow/main/deploy/vps-bootstrap.sh | DOMAIN=example.uz bash
#
# Idempotent: safe to re-run for updates (git pull + rebuild) or to switch to
# a domain later by re-running with DOMAIN set. Generates a strong admin
# password + JWT secret on first run and PRINTS the admin password ONCE — save it.
set -euo pipefail

DOMAIN="${DOMAIN:-}"
REPO="https://github.com/nvrdiyor/nestflow.git"
DIR="${DIR:-/opt/nestflow}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo -i)." >&2
  exit 1
fi

# --- 1. Docker -----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
else
  say "Docker already installed."
fi

if ! command -v git >/dev/null 2>&1; then
  say "Installing git…"
  apt-get update -qq && apt-get install -y -qq git
fi

# --- 2. Code -------------------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR…"
  git -C "$DIR" pull --ff-only
else
  say "Cloning into $DIR…"
  git clone "$REPO" "$DIR"
fi
cd "$DIR"

# --- 3. .env -------------------------------------------------------------------
# set_kv KEY VALUE — insert or update KEY=VALUE in .env
set_kv() {
  if grep -q "^$1=" .env 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}

NEW_ADMIN_PASSWORD=""
if [ ! -f .env ] || ! grep -q '^ADMIN_PASSWORD=' .env; then
  say "Generating credentials…"
  # openssl, not `tr </dev/urandom | head`: head closing the pipe SIGPIPEs tr,
  # which under `set -o pipefail` kills the whole script (exit 141).
  NEW_ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-20)"
  touch .env
  set_kv ADMIN_USERNAME "nvrdiyor"
  set_kv ADMIN_PASSWORD "$NEW_ADMIN_PASSWORD"
  set_kv JWT_SECRET "$(openssl rand -hex 32)"
fi
if [ -n "$DOMAIN" ]; then
  set_kv DOMAIN "$DOMAIN"
  set_kv HTTP_PORT "127.0.0.1:8787" # Caddy owns 80/443
  set_kv TRUST_PROXY "1"            # exactly one proxy hop (Caddy)
fi
chmod 600 .env

# --- 4. Firewall (best-effort) -------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  say "Configuring firewall (22, 80, 443)…"
  ufw allow OpenSSH >/dev/null || true
  ufw allow 80/tcp >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
  ufw --force enable >/dev/null || true
fi

# --- 5. Launch -----------------------------------------------------------------
say "Building and starting NestFlow…"
if [ -n "$DOMAIN" ]; then
  docker compose --profile https up -d --build
else
  docker compose up -d --build
fi

# --- Done ----------------------------------------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "NestFlow is up."
if [ -n "$DOMAIN" ]; then
  echo "    URL:    https://$DOMAIN   (certificate may take ~1 min on first start)"
else
  echo "    URL:    http://$IP"
fi
echo   "    Admin:  <URL>/#/login -> Admin sign in"
if [ -n "$NEW_ADMIN_PASSWORD" ]; then
  echo "    Admin username: nvrdiyor"
  echo "    Admin password: $NEW_ADMIN_PASSWORD"
  echo "    ^^^ SAVE THIS PASSWORD NOW — it is stored only in $DIR/.env (chmod 600)."
fi
echo   "    Logs:   docker compose -f $DIR/docker-compose.yml logs -f"
echo   "    Update: re-run this script."
