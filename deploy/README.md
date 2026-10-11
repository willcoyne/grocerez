# GrocerEZ deploy runbook (Akamai Cloud / Linode)

One 4 GB Linode runs Docker Compose: `postgres`, `server`, `agent` (internal only), `caddy` (TLS + static web build).
Only Caddy publishes ports (80/443). Secrets live in `deploy/.env` on the box only (gitignored).

## 1. Create the instance (Cloud Manager)
1. Linodes > Create: Image **Ubuntu 24.04 LTS**, Region **Chicago, IL (us-ord)**, Plan **Shared CPU 4 GB**, set a root password, add every teammate's **SSH public key**.
2. Networking > Firewalls > Create: inbound **TCP 22, TCP 80, TCP 443** (and UDP 443 for HTTP/3), default inbound policy **Drop**; attach to the Linode. Note its IPv4.
3. Hostname for HTTPS (pick one):
   - Free DNS: create an A record `<name>.duckdns.org` (or any DNS you own) pointing at the IPv4.
   - No DNS: Linode > Network > IP > **Edit RDNS** gives a `<ip-dashed>.ip.linodeusercontent.com` name; use that as the host.
   Check: `dig +short <host>` returns the IPv4 before step 4 (Caddy needs this to get a certificate).

## 2. Object Storage (Cloud Manager)
1. Object Storage > Create Bucket: label `grocerez-uploads`, region **us-ord**, keep it private.
2. Access Keys > Create: limited access, `grocerez-uploads` read/write. Copy the key and secret now (shown once).
3. Endpoint is `https://us-ord-1.linodeobjects.com` (confirm the cluster id on the bucket's page).

## 3. Bootstrap the box
```bash
ssh root@<ip>
apt-get update && apt-get install -y git
git clone <repo-url> /opt/grocerez && cd /opt/grocerez && git checkout <deploy-branch>
bash deploy/bootstrap.sh <repo-url>      # installs Docker, ufw 22/80/443; skips the clone (already there)
cd deploy && cp .env.example .env && chmod 600 .env && nano .env
```
Fill every variable (`openssl rand -hex 32` for each password and secret). `DOMAIN` is the bare host, `AGENT_SHARED_SECRET` is
used by both server and agent, `S3_*`/`AWS_*` are the Object Storage values from step 2, `AKAMAI_INFERENCE_*` are the team credentials.

## 4. Build the web app and start
```bash
cd /opt/grocerez
# optional: export EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=... EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=... EXPO_PUBLIC_DEMO_KEY=...
./deploy/build-web.sh <host>        # EXPO_PUBLIC_API_URL=https://<host>/api; output deploy/web-dist (Dockerized node, a few minutes)
cd deploy && docker compose up -d --build
docker compose ps                   # migrate and app-role show "Exited (0)"; server becomes healthy
```
Startup order (automatic): `postgres` healthy > `migrate` (owner, `prisma migrate deploy`) > `app-role` (runs
`server/prisma/sql/app-role.sql` as owner, creating/refreshing `grocerez_app` with `GROCEREZ_APP_PASSWORD`) > `server`
(connects as `grocerez_app`) > `caddy`. The role step is idempotent and repeats on every `up`, so new migrations are always covered.
Native app builds need the same `EXPO_PUBLIC_API_URL=https://<host>/api`.

## 5. Seed (demo data)
```bash
docker compose exec server npx prisma db seed     # uses MIGRATE_DATABASE_URL (owner)
```

## 6. Smoke checks
```bash
curl -fsS https://<host>/api/health                              # 200 JSON
curl -fsS "https://<host>/socket.io/?EIO=4&transport=polling"    # body starts with 0{"sid":... (Socket.IO handshake through Caddy)
curl -fsSI https://<host>/ | head -1                             # 200, the web app
# agent is internal only:
docker compose exec server node -e "fetch('http://agent:8000/').then(r=>console.log('internal HTTP',r.status))"   # any status proves the compose-network path
curl -m 5 http://<ip>:8000/ ; echo "exit=$?"                     # must fail to connect (non-zero exit)
nmap -Pn -p 22,80,443,3000,5432,8000 <ip>                        # from your laptop: only 22/80/443 open
```
Then in the web app: sign in, run "Plan our week", confirm steps stream and the list updates in a second browser.

## 7. Logs and day-2
```bash
docker compose logs -f --since 10m server agent caddy
docker compose ps
docker compose restart server
git pull && ./deploy/build-web.sh <host> && (cd deploy && docker compose up -d --build)   # update; rebuild web only if app/ changed
```
Watch for: server `Invalid environment configuration` (missing var), Caddy certificate errors (DNS or port 80), agent 401s (secret mismatch).

## 8. Rollback
```bash
cd /opt/grocerez && git log --oneline -5          # find the last good commit
git checkout <good-sha>
./deploy/build-web.sh <host>                      # only if the web app changed
cd deploy && docker compose up -d --build
```
Migrations are forward-only: roll back to code compatible with the current schema, or restore a dump taken beforehand:
```bash
docker compose exec -T postgres pg_dump -U grocerez grocerez > ~/grocerez-$(date +%F).sql    # take BEFORE risky deploys
docker compose exec -T postgres psql -U grocerez -d grocerez < ~/grocerez-<date>.sql          # restore into an empty DB
```
Full reset (destroys data): `docker compose down -v`, then step 4. Avoid `-v` unless needed: it also deletes `caddy_data`
(certificates) and risks Let's Encrypt rate limits.

## Notes
- Contact for access, billing and keys: the team's Akamai account owner (fill in here).
- Docker-published ports bypass ufw; that is why compose publishes only Caddy's 80/443 and the Cloud Firewall repeats the rule.
- `deploy/.env` holds the only copy of the secrets; back it up out of band (password manager), never in git or chat.
