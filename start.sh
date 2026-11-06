#!/bin/bash
# =================================================================
# Freedom Panel — Start Script (Nginx replaces Mux + Stunnel)
# =================================================================

ulimit -n 65535 2>/dev/null
ulimit -s unlimited 2>/dev/null

SYS_CFG="/tmp/system_config.json"

# =================================================================
# 🧹 PEMBERSIHAN PROSES LAMA
# =================================================================
echo "[*] Membersihkan proses lama..."
pkill -9 -f "node server"             2>/dev/null
pkill -9 -f "/usr/local/bin/wsproxy"  2>/dev/null
pkill -9 -f "/usr/local/bin/mux"      2>/dev/null
pkill -9 -f "node ws-proxy"           2>/dev/null
pkill -9 -f "node mux"                2>/dev/null
pkill -9 dropbear                     2>/dev/null
pkill -9 stunnel4                     2>/dev/null
pkill -9 nginx                        2>/dev/null
pkill -9 cloudflared                  2>/dev/null
pkill -9 badvpn-udpgw                 2>/dev/null
for p in 8443 2443 8880 8881 8081 80; do fuser -k ${p}/tcp 2>/dev/null; done
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
<p style="text-align:center;"><b>
    <font color="#800080">▬</font><font color="#8A2BE2">▬</font><font color="#9370DB">▬</font><font color="#7B68EE">▬ஜ۩۞۩ஜ▬</font><font color="#7B68EE">▬</font><font color="#9370DB">▬</font><font color="#8A2BE2">▬</font><font color="#800080">▬</font><br>
    <font color="#800080">─── SERVER PREMIUM ───</font><br>
    <font color="#8A2BE2">! TERM OF SERVICE !</font><br>
    <font color="#9370DB">NO MULTI LOGIN / NO TORRENT</font><br>
    <font color="#8A2BE2">NO SPAM, NO DDOS, NO HACKING</font><br>
    <font color="#800080">▬</font><font color="#8A2BE2">▬</font><font color="#9370DB">▬</font><font color="#7B68EE">▬ஜ۩۞۩ஜ▬</font><font color="#7B68EE">▬</font><font color="#9370DB">▬</font><font color="#8A2BE2">▬</font><font color="#800080">▬</font><br></b>
</p>
EOF
fi

# =================================================================
# 🔒 SSL SERTIFIKAT (self-signed, untuk SNI bug host)
# =================================================================
SSL_INTERNAL_PORT="2443"      # Nginx TLS terminator
SSH_PORT_LOCAL="22"

mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/server.crt ]; then
    openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
        -subj "/C=ID/ST=Jakarta/L=Jakarta/O=RailwaySSH/CN=bug.com" \
        -keyout /etc/nginx/ssl/server.key \
        -out    /etc/nginx/ssl/server.crt 2>/dev/null
    chmod 600 /etc/nginx/ssl/server.key
    echo "[*] Self-signed cert dibuat (SNI bug host ready)"
fi

# =================================================================
# 🐚 DROPBEAR
# =================================================================
echo "[*] Dropbear di 127.0.0.1:${SSH_PORT_LOCAL}"
/usr/sbin/dropbear -p 127.0.0.1:${SSH_PORT_LOCAL} \
    -b /etc/dropbear_banner -W 1048576 -K 15 -I 300
sleep 1

# =================================================================
# 🔌 WS-PROXY (Go binary) — filter SSH handshake, dipanggil dari Nginx
# =================================================================
if [ -x /usr/local/bin/wsproxy ]; then
    echo "[*] WS-Proxy Go di 127.0.0.1:8880"
    WS_PORT=8880 WS_BIND=127.0.0.1 nohup /usr/local/bin/wsproxy >/dev/null 2>&1 &
else
    echo "[!] /usr/local/bin/wsproxy tidak ada"
fi

# =================================================================
# 🚀 BADVPN UDPGW (UDP Gaming — TCP proxy Railway tidak support UDP)
# =================================================================
if [ -f /usr/local/bin/badvpn-udpgw ]; then
    echo "[*] BadVPN udpgw di 0.0.0.0:${UDPGW_PORT}"
    nohup /usr/local/bin/badvpn-udpgw --listen-addr 0.0.0.0:${UDPGW_PORT} \
        --max-clients ${UDPGW_MAX_CLIENTS} \
        --max-connections-for-client 50 >/dev/null 2>&1 &
fi

# =================================================================
# ☁️ TOKEN CLOUDFLARE → server.cjs
# =================================================================
if [ -n "$TOKEN" ]; then
    echo "$TOKEN" > /tmp/zt_single_token.txt
else
    rm -f /tmp/zt_single_token.txt 2>/dev/null
fi

sleep 1

# =================================================================
# 🌐 NGINX — Multiplexer (:8443) + TLS Terminator (:2443) + Panel (:80)
# =================================================================
mkdir -p /var/log/nginx /var/run
if [ -x /usr/sbin/nginx ] || command -v nginx >/dev/null 2>&1; then
    echo "[*] Nginx: multiplex :8443 | TLS term :2443 | HTTP panel :80"
    nginx -c /etc/nginx/nginx.conf -t 2>&1 | grep -v "syntax is ok" || true
    nginx -c /etc/nginx/nginx.conf
else
    echo "[!] Nginx tidak terinstall!"
fi

sleep 1

# =================================================================
# 🎯 SERVER UTAMA (Node panel UI) — last, karena foreground
# =================================================================
echo "[*] Menjalankan server.cjs di 8081..."
PORT=8081 exec node /app/server.cjs
