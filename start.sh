#!/bin/bash

ulimit -n 65535 2>/dev/null
ulimit -s unlimited 2>/dev/null

SYS_CFG="/tmp/system_config.json"

# =================================================================
# 🧹 PEMBERSIHAN PROSES LAMA
# =================================================================
echo "[*] Membersihkan proses lama..."
pkill -9 -f "node server"             2>/dev/null
pkill -9 -f "/usr/local/bin/mux"      2>/dev/null
pkill -9 -f "/usr/local/bin/wsproxy"  2>/dev/null
pkill -9 -f "node ws-proxy"           2>/dev/null
pkill -9 -f "node mux"                2>/dev/null
pkill -9 dropbear                     2>/dev/null
pkill -9 stunnel4                     2>/dev/null
pkill -9 cloudflared                  2>/dev/null
pkill -9 badvpn-udpgw                 2>/dev/null
fuser -k 8880/tcp 2>/dev/null
fuser -k 8881/tcp 2>/dev/null
fuser -k 8081/tcp 2>/dev/null
sleep 1

# =================================================================
# 🔍 BACA CONFIG DINAMIS
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
# 🚀 KERNEL TWEAKS + BBR
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
# 🎨 BANNER DROPBEAR
# =================================================================
if [ -n "$CUSTOM_BANNER" ]; then
    echo -e "$CUSTOM_BANNER" > /etc/dropbear_banner
else
    cat << 'EOF' > /etc/dropbear_banner
=== SSH SERVER PANEL ===
 powered by : Freedom
=========================
EOF
fi

# =================================================================
# 🔒 DROPBEAR + STUNNEL
# =================================================================
SSL_INTERNAL_PORT="2443"

mkdir -p /etc/stunnel /var/run/stunnel4
openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 \
    -subj "/C=ID/ST=Jakarta/L=Jakarta/O=RailwaySSH/CN=localhost" \
    -keyout /etc/stunnel/stunnel.pem -out /etc/stunnel/stunnel.pem 2>/dev/null
chmod 600 /etc/stunnel/stunnel.pem

# Baca sshPort dari config wsproxy (default 22)
SSH_PORT_LOCAL="22"
if [ -f /tmp/ws_proxy_config.json ] && command -v jq >/dev/null 2>&1; then
    SSH_PORT_LOCAL=$(jq -r '.sshPort // 22' /tmp/ws_proxy_config.json)
fi
echo "[*] Dropbear di 127.0.0.1:${SSH_PORT_LOCAL}"
/usr/sbin/dropbear -p 127.0.0.1:${SSH_PORT_LOCAL} -b /etc/dropbear_banner -W 1048576 -K 15 -I 300
sleep 1

cat <<EOF > /etc/stunnel/stunnel.conf
pid = /var/run/stunnel4/stunnel.pid
foreground = no
debug = 0

[ssh-ssl]
accept = 127.0.0.1:${SSL_INTERNAL_PORT}
connect = 127.0.0.1:${SSH_PORT_LOCAL}
cert = /etc/stunnel/stunnel.pem
EOF

rm -f /var/run/stunnel4/stunnel.pid 2>/dev/null
stunnel4 /etc/stunnel/stunnel.conf

# =================================================================
# 🔌 WS-PROXY (GO BINARY) — baca /tmp/ws_proxy_config.json
# =================================================================
if [ -x /usr/local/bin/wsproxy ]; then
    echo "[*] WS-Proxy Go di 127.0.0.1:8880 (config: /tmp/ws_proxy_config.json)"
    WS_PORT=8880 WS_BIND=127.0.0.1 nohup /usr/local/bin/wsproxy >/dev/null 2>&1 &
else
    echo "[!] /usr/local/bin/wsproxy tidak ada"
fi

# =================================================================
# 🚀 BADVPN UDPGW
# =================================================================
if [ -f /usr/local/bin/badvpn-udpgw ]; then
    echo "[*] BadVPN udpgw di 0.0.0.0:${UDPGW_PORT}"
    nohup /usr/local/bin/badvpn-udpgw --listen-addr 0.0.0.0:${UDPGW_PORT} \
        --max-clients ${UDPGW_MAX_CLIENTS} --max-connections-for-client 50 >/dev/null 2>&1 &
fi

# =================================================================
# ☁️ TOKEN CLOUDFLARE → server.cjs (single owner)
# =================================================================
if [ -n "$TOKEN" ]; then
    echo "$TOKEN" > /tmp/zt_single_token.txt
else
    rm -f /tmp/zt_single_token.txt 2>/dev/null
fi

sleep 1

# =================================================================
# 🧩 MUX (GO BINARY) — Split TLS vs WS
# =================================================================
if [ -x /usr/local/bin/mux ]; then
    echo "[*] Mux Go di 0.0.0.0:8881 (SSL→2443, WS→8880)"
    PORT=8881 \
    SSL_TARGET_HOST=127.0.0.1  SSL_TARGET_PORT=2443 \
    WS_MUX_TARGET_HOST=127.0.0.1 WS_MUX_TARGET_PORT=8880 \
    nohup /usr/local/bin/mux >/dev/null 2>&1 &
fi

sleep 1

# =================================================================
# 🎯 SERVER UTAMA (Node panel UI)
# =================================================================
echo "[*] Menjalankan server.cjs di 8081..."
PORT=8081 exec node /app/server.cjs
