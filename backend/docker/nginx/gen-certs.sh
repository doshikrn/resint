#!/bin/sh
# Generates a self-signed TLS certificate for the nginx proxy.
#
# Run once on the server before the first `docker compose up`:
#   sh backend/docker/nginx/gen-certs.sh
#
# For real production use Let's Encrypt instead:
#   certbot certonly --standalone -d your-domain.com
#   cp /etc/letsencrypt/live/your-domain.com/fullchain.pem backend/docker/nginx/certs/
#   cp /etc/letsencrypt/live/your-domain.com/privkey.pem    backend/docker/nginx/certs/
#   docker compose -f backend/docker-compose.prod.yml up -d --no-build proxy
#
# Certs are gitignored (*.pem) and must be present on the server's filesystem.
# They survive `git pull` because git does not touch gitignored files.

set -eu

DIR="$(cd "$(dirname "$0")/certs" && pwd)"
FULLCHAIN="$DIR/fullchain.pem"
PRIVKEY="$DIR/privkey.pem"

if [ -f "$FULLCHAIN" ] && [ -f "$PRIVKEY" ]; then
    echo "Certs already exist in $DIR — skipping generation."
    exit 0
fi

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$PRIVKEY" \
    -out "$FULLCHAIN" \
    -subj "/CN=localhost/O=InventoryApp"

echo ""
echo "Self-signed certificate generated:"
echo "  $FULLCHAIN"
echo "  $PRIVKEY"
echo ""
echo "NOTE: Self-signed certs will trigger browser warnings."
echo "Replace with Let's Encrypt certs for production."
