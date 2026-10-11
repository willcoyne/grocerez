#!/usr/bin/env bash
# Deploys GrocerEZ to Akamai Cloud (Linode): one instance running Postgres + API (with the Akamai AI agent) + web app
# behind Caddy (HTTPS on the instance's free *.ip.linodeusercontent.com name), and optionally a Linode Object Storage
# bucket for photos. Safe to re-run: it finds the existing instance/bucket and just ships the new code.
#
#   export LINODE_TOKEN=...        # or put it in deploy/linode/.token (git-ignored); cloud.linode.com → Profile →
#                                  # API Tokens with read/write on Linodes, Firewalls and Object Storage
#   deploy/linode/deploy.sh                 # create or update the instance
#   deploy/linode/deploy.sh --with-storage  # also create the Object Storage bucket + keys and wire them into the API
#
# Optional env: LINODE_REGION (default us-ord, Chicago), LINODE_TYPE (default g6-standard-2, 4 GB),
#               SITE_HOST (your own domain pointed at the instance, instead of the rDNS name).
# Secrets: server/.env provides AKAMAI_* (and any other keys); generated secrets live in deploy/linode/.env.
# Both files are git-ignored. Nothing secret is printed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/deploy/linode"
REGION="${LINODE_REGION:-us-ord}"
TYPE="${LINODE_TYPE:-g6-standard-2}"
LABEL="grocerez"
KEY="$HOME/.ssh/grocerez_linode"
WITH_STORAGE=false
[[ "${1:-}" == "--with-storage" ]] && WITH_STORAGE=true
# Token: $LINODE_TOKEN, else the git-ignored file deploy/linode/.token (one line).
[[ -z "${LINODE_TOKEN:-}" && -f "$HERE/.token" ]] && LINODE_TOKEN="$(tr -d '[:space:]' < "$HERE/.token")"
: "${LINODE_TOKEN:?export LINODE_TOKEN or put it in deploy/linode/.token (cloud.linode.com → Profile → API Tokens)}"

api() { # api METHOD PATH [JSON]
  curl -sS --fail-with-body -X "$1" "https://api.linode.com/v4$2" \
    -H "Authorization: Bearer $LINODE_TOKEN" -H "Content-Type: application/json" ${3:+-d "$3"}
}
log() { printf '\033[1m==> %s\033[0m\n' "$*"; }

# ── SSH key used only for this server ──────────────────────────────────────────────
[[ -f "$KEY" ]] || ssh-keygen -q -t ed25519 -N "" -f "$KEY" -C "grocerez-linode"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)

# ── Instance ───────────────────────────────────────────────────────────────────────
ID=$(api GET "/linode/instances?page_size=500" | jq -r --arg l "$LABEL" '.data[] | select(.label == $l) | .id' | head -1)
if [[ -z "$ID" ]]; then
  log "Creating Linode $LABEL ($TYPE in $REGION)"
  ROOT_PASS=$(openssl rand -base64 30)
  ID=$(api POST /linode/instances "$(jq -n --arg r "$REGION" --arg t "$TYPE" --arg l "$LABEL" --arg p "$ROOT_PASS" \
    --arg k "$(cat "$KEY.pub")" \
    '{region: $r, type: $t, label: $l, image: "linode/ubuntu24.04", root_pass: $p, authorized_keys: [$k],
      tags: ["grocerez", "hackmidwest"], booted: true}')" | jq -r .id)
else
  log "Using existing Linode $LABEL (id $ID)"
fi
until [[ "$(api GET "/linode/instances/$ID" | jq -r .status)" == "running" ]]; do sleep 5; done
IP=$(api GET "/linode/instances/$ID" | jq -r '.ipv4[0]')
RDNS=$(api GET "/linode/instances/$ID/ips" | jq -r '.ipv4.public[0].rdns')
HOST="${SITE_HOST:-$RDNS}"
log "Instance $IP, site https://$HOST"

# ── Cloud firewall: only SSH + HTTP(S) ─────────────────────────────────────────────
FW=$(api GET "/networking/firewalls?page_size=500" | jq -r '.data[] | select(.label == "grocerez-fw") | .id' | head -1)
if [[ -z "$FW" ]]; then
  log "Creating cloud firewall"
  api POST /networking/firewalls "$(jq -n --argjson id "$ID" '{label: "grocerez-fw", devices: {linodes: [$id]},
    rules: {inbound_policy: "DROP", outbound_policy: "ACCEPT", inbound: [
      {label: "ssh", action: "ACCEPT", protocol: "TCP", ports: "22", addresses: {ipv4: ["0.0.0.0/0"], ipv6: ["::/0"]}},
      {label: "web", action: "ACCEPT", protocol: "TCP", ports: "80,443", addresses: {ipv4: ["0.0.0.0/0"], ipv6: ["::/0"]}}]}}')" >/dev/null
fi

# ── Generated secrets (kept locally so re-deploys reuse them) ──────────────────────
if [[ ! -f "$HERE/.env" ]]; then
  log "Generating deploy/linode/.env"
  umask 077
  cat > "$HERE/.env" <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
DEMO_KEY=$(openssl rand -hex 12)
EOF
fi
# SITE_HOST always follows the current instance / override.
grep -v '^SITE_HOST=' "$HERE/.env" > "$HERE/.env.tmp" || true
echo "SITE_HOST=$HOST" >> "$HERE/.env.tmp" && mv "$HERE/.env.tmp" "$HERE/.env" && chmod 600 "$HERE/.env"

# ── API secrets: server/.env minus the local-only database settings ────────────────
umask 077
grep -vE '^(DATABASE_URL|MIGRATE_DATABASE_URL|TEST_DATABASE_URL|JWT_SECRET|NODE_ENV|PORT|CORS_ORIGINS)=' "$ROOT/server/.env" \
  > "$ROOT/server/.env.prod" 2>/dev/null || true

# ── Optional: Linode Object Storage for photos (S3-compatible) ─────────────────────
if $WITH_STORAGE; then
  BUCKET="grocerez-$(echo "$ID" | tail -c 7)"
  if ! api GET "/object-storage/buckets/$REGION/$BUCKET" >/dev/null 2>&1; then
    log "Creating Object Storage bucket $BUCKET"
    api POST /object-storage/buckets "$(jq -n --arg r "$REGION" --arg b "$BUCKET" '{region: $r, label: $b, acl: "private"}')" >/dev/null
  fi
  S3_HOSTNAME=$(api GET "/object-storage/buckets/$REGION/$BUCKET" | jq -r .hostname)   # <bucket>.<cluster>.linodeobjects.com
  CLUSTER=${S3_HOSTNAME#"$BUCKET".}; CLUSTER=${CLUSTER%%.linodeobjects.com}
  if ! grep -q '^S3_BUCKET=' "$HERE/.env.storage" 2>/dev/null; then
    log "Creating a bucket-scoped Object Storage key"
    KEYS=$(api POST /object-storage/keys "$(jq -n --arg r "$REGION" --arg b "$BUCKET" \
      '{label: "grocerez-api", bucket_access: [{region: $r, bucket_name: $b, permissions: "read_write"}]}')")
    cat > "$HERE/.env.storage" <<EOF
S3_BUCKET=$BUCKET
S3_ENDPOINT=https://$CLUSTER.linodeobjects.com
AWS_REGION=$CLUSTER
AWS_ACCESS_KEY_ID=$(echo "$KEYS" | jq -r .access_key)
AWS_SECRET_ACCESS_KEY=$(echo "$KEYS" | jq -r .secret_key)
EOF
    chmod 600 "$HERE/.env.storage"
  fi
fi
[[ -f "$HERE/.env.storage" ]] && cat "$HERE/.env.storage" >> "$ROOT/server/.env.prod"

# ── Host setup (idempotent): Docker, swap for image builds, host firewall ──────────
log "Waiting for SSH"
until "${SSH[@]}" "root@$IP" true 2>/dev/null; do sleep 5; done
"${SSH[@]}" "root@$IP" 'bash -s' <<'EOF'
set -e
command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh; }
command -v rsync >/dev/null || { apt-get update -qq && apt-get install -y -qq rsync; }
[ -f /swapfile ] || { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; }
mkdir -p /opt/grocerez
EOF

# ── Ship the code and start the stack ──────────────────────────────────────────────
log "Copying the repo"
rsync -az --delete -e "${SSH[*]}" \
  --exclude .git --exclude node_modules --exclude '.claude' --exclude dev-console --exclude 'server/generated' \
  --exclude 'server/.env' --exclude 'app/.env' --exclude 'app/dist' --exclude '.expo' \
  "$ROOT/" "root@$IP:/opt/grocerez/"
log "Building and starting (first build takes a few minutes)"
"${SSH[@]}" "root@$IP" 'cd /opt/grocerez && docker compose -f deploy/linode/compose.yml --env-file deploy/linode/.env up -d --build --remove-orphans'

log "Waiting for https://$HOST/api/health"
for _ in $(seq 1 60); do curl -sf "https://$HOST/api/health" >/dev/null && break; sleep 5; done
curl -sf "https://$HOST/api/health" >/dev/null && log "Live: https://$HOST" || log "Not healthy yet: ssh -i $KEY root@$IP 'cd /opt/grocerez && docker compose -f deploy/linode/compose.yml logs --tail 50'"
