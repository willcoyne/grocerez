#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu LTS box (run as root or with sudo):
#   sudo bash bootstrap.sh <git-clone-url>
# Installs Docker, opens only 22/80/443 (ufw), clones the repo to /opt/grocerez. Does NOT start the stack (needs deploy/.env first).
set -euo pipefail
REPO="${1:?usage: bootstrap.sh <git-clone-url>}"
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }

apt-get update -y
apt-get install -y ca-certificates curl git ufw
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Host firewall. Docker-published ports bypass ufw, so compose publishes only caddy's 80/443.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

[ -d /opt/grocerez ] || git clone "$REPO" /opt/grocerez
echo "Next: cd /opt/grocerez/deploy && cp .env.example .env && chmod 600 .env && edit .env"
