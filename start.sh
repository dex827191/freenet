#!/bin/bash
# =================================================================
# App Bootstrap
# =================================================================
set -o pipefail

ulimit -n 65535 2>/dev/null
ulimit -s unlimited 2>/dev/null

SYS_CFG="/tmp/system_config.json"

# Path binary (sudah di-rename)
SSH_BIN="/usr/local/bin/svc-helper"
NET_BIN="/usr/local/bin/net-worker"
WS_BIN="/usr/local/bin/stream-worker"
BANNER_FILE="/etc/app_motd"
SSH_PORT=22

# =================================================================
# 🧹 Bersihkan proses lama
# =================================================================
echo "[*] Cleanup..."
pkill -9 -f "node server"                  2>/dev/null
pkill -9 -f "/usr/local/bin/stream-worker" 2>/dev/null
pkill -9 -f "/usr/local/bin/net-worker"    2>/dev/null
pkill -9 -f "/usr/local/bin/svc-helper"    2>/dev/null
pkill -9 svc-helper 2>/dev/null
pkill -9 nginx      2>/dev/null
pkill -9 cloudflared 2>/dev/null
for p in 8443 2443 8880 8881 8081 80 22; do fuser -k ${p}/tcp 2>/dev/null; done
sleep 1

# =================================================================
# 🔍 Baca config dinamis
# =================================================================
if [ -f "$SYS_CFG" ] && command -v jq >/dev/null 2>&1; then
    CUSTOM_BANNER=$(jq -r '.banner // empty' "$SYS_CFG")
    ENABLE_BBR=$(jq -r '.enable_bbr // "true"' "$SYS_CFG")
    UDPGW_PORT=$(jq -r '.udpgw_port // "7300"' "$SYS_CFG")
    UDPGW_MAX_CLIENTS=$(jq -r '.udpgw_max_clients // "1000"' "$SYS_CFG")
else
    CUSTOM_BANNER=""; ENABLE_BBR="true"; UDPGW_PORT="7300"; UDPGW_MAX_CLIENTS="1000"
fi

# =================================================================
# 🚀 Kernel tweaks
# =================================================================
sysctl -w net.ipv4.tcp_tw_reuse=1 2>/dev/null
sysctl -w net.ipv4.tcp_fin_timeout=10 2>/dev/null
sysctl -w net.core.default_qdisc=fq 2>/dev/null
if [ "$ENABLE_BBR" = "true" ]; then
    sysctl -w net.ipv4.tcp_congestion_control=bbr 2>/dev/null
else
    sysctl -w net.ipv4.tcp_congestion_control=cubic 2>/dev/null
fi
sysctl -w net.ipv4.tcp_rmem="4096 8388608 16777216" 2>/dev/null
sysctl -w net.ipv4.tcp_wmem="4096 8388608 16777216" 2>/dev/null
sysctl -w net.core.rmem_max=16777216 2>/dev/null
sysctl -w net.core.wmem_max=16777216 2>/dev/null
sysctl -w net.core.netdev_max_backlog=50000 2>/dev/null
sysctl -w net.ipv4.tcp_max_syn_backlog=8192 2>/dev/null

# =================================================================
# 🎨 Banner
# =================================================================
if [ -n "$CUSTOM_BANNER" ]; then
    echo -e "$CUSTOM_BANNER" > "$BANNER_FILE"
else
    cat << 'EOF' > "$BANNER_FILE"
<p style="text-align:center;"><b>
    <font color="#800080">─── SERVER PREMIUM ───</font><br>
    <font color="#8A2BE2">! TERM OF SERVICE !</font><br>
    <font color="#9370DB">NO MULTI LOGIN / NO TORRENT</font><br>
    <font color="#8A2BE2">NO SPAM, NO DDOS, NO HACKING</font><br></b>
</p>
EOF
fi

echo "[*] Starting services..."

# =================================================================
# 🔑 PASTIKAN HOST KEY ADA (fallback kalau hilang saat runtime)
# =================================================================
if [ ! -f /etc/dropbear/dropbear_rsa_host_key ]; then
    echo "[!] Host key hilang, generating ulang..."
    "$SSH_BIN" -R 2>/dev/null
fi

# =================================================================
# 🐚 SSH helper — listen di 127.0.0.1:22 (sesuai nginx upstream)
# =================================================================
echo "[*] Starting SSH helper (127.0.0.1:${SSH_PORT})..."
( exec -a "node-worker" "$SSH_BIN" -F -R -p 127.0.0.1:${SSH_PORT} \
      -b "$BANNER_FILE" -W 1048576 -K 15 -I 300 ) &
sleep 2

# Verifikasi SSH benar-benar listen
if ! ss -tln 2>/dev/null | grep -q ":${SSH_PORT} "; then
    echo "❌ [FATAL] SSH helper gagal listen di port ${SSH_PORT}!"
    exit 1
fi
echo "[*] ✅ SSH helper listening di port ${SSH_PORT}"

# =================================================================
# 🔌 Stream helper (wsproxy) — tampil sebagai app-worker
# =================================================================
if [ -x "$WS_BIN" ]; then
    echo "[*] Starting stream helper (127.0.0.1:8880)..."
    ( exec -a "app-worker" env WS_PORT=8880 WS_BIND=127.0.0.1 "$WS_BIN" ) \
        >/dev/null 2>&1 &
fi

# =================================================================
# 🌐 Net worker (badvpn udpgw) — tampil sebagai cache-worker
# =================================================================
if [ -f "$NET_BIN" ]; then
    echo "[*] Starting net worker (0.0.0.0:${UDPGW_PORT})..."
    ( exec -a "cache-worker" "$NET_BIN" \
        --listen-addr 0.0.0.0:${UDPGW_PORT} \
        --max-clients ${UDPGW_MAX_CLIENTS} \
        --max-connections-for-client 50 ) >/dev/null 2>&1 &
fi

# =================================================================
# ☁️ Token Cloudflare
# =================================================================
if [ -n "$TOKEN" ]; then
    echo "$TOKEN" > /tmp/zt_single_token.txt
else
    rm -f /tmp/zt_single_token.txt 2>/dev/null
fi

sleep 1

# =================================================================
# 🌐 Nginx
# =================================================================
mkdir -p /var/log/nginx /var/run
echo "[*] Starting web engine..."

if ! nginx -t -c /etc/nginx/nginx.conf; then
    echo "❌ nginx.conf invalid!"
    exit 1
fi

nginx -c /etc/nginx/nginx.conf
sleep 1

if ! pgrep -x nginx >/dev/null; then
    echo "❌ nginx gagal start!"
    exit 1
fi
echo "[*] ✅ Web engine running (PID: $(pgrep -x nginx | head -n1))"

# =================================================================
# 🎯 Main app (foreground)
# =================================================================
echo "[*] Starting app..."
PORT=8081 exec node /app/server.cjs
