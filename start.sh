#!/bin/bash

# 🔥 KUNCI UTAMA ANTI SUNEK: Buka limit socket container sedalam mungkin
ulimit -n 65535 2>/dev/null
ulimit -s unlimited 2>/dev/null

SYS_CFG="/tmp/system_config.json"

# =================================================================
# 🧹 PEMBERSIHAN PROSES LAMA (PREVENT EADDRINUSE)
# =================================================================
echo "[*] Memersihkan proses lama & port yang tersangkut..."
# Perbaikan: pkill spesifik per proses, jangan -f "node" (bisa bunuh ws-proxy / mux)
pkill -9 -f "node server"   2>/dev/null
pkill -9 -f "node ws-proxy" 2>/dev/null
pkill -9 -f "node mux"      2>/dev/null
pkill -9 dropbear 2>/dev/null
pkill -9 stunnel4 2>/dev/null
pkill -9 cloudflared 2>/dev/null
pkill -9 badvpn-udpgw 2>/dev/null

# Paksa bebaskan port jika fuser tersedia
fuser -k 8880/tcp 2>/dev/null
fuser -k 8881/tcp 2>/dev/null
fuser -k 8081/tcp 2>/dev/null
sleep 1

# =================================================================
# 🔍 BACA KONFIGURASI DINAMIS DARI FILE JSON UI
# =================================================================
if [ -f "$SYS_CFG" ] && command -v jq >/dev/null 2>&1; then
    CUSTOM_BANNER=$(jq -r '.banner // empty' "$SYS_CFG")
    ENABLE_BBR=$(jq -r '.enable_bbr // "true"' "$SYS_CFG")
    UDPGW_PORT=$(jq -r '.udpgw_port // "7300"' "$SYS_CFG")
    UDPGW_MAX_CLIENTS=$(jq -r '.udpgw_max_clients // "1000"' "$SYS_CFG")
else
    CUSTOM_BANNER=""
    ENABLE_BBR="true"
    UDPGW_PORT="7300"
    UDPGW_MAX_CLIENTS="1000"
fi

# =================================================================
# 🚀 ULTRA TURBO KERNEL TWEAKS & BBR SWITCH
# =================================================================
echo "[*] Mengoptimalkan antrean socket & pembersihan TIME_WAIT..."
sysctl -w net.ipv4.tcp_tw_reuse=1 2>/dev/null
sysctl -w net.ipv4.tcp_fin_timeout=10 2>/dev/null
sysctl -w net.core.default_qdisc=fq 2>/dev/null

if [ "$ENABLE_BBR" = "true" ]; then
    echo "[*] Mengaktifkan TCP BBR Congestion Control..."
    sysctl -w net.ipv4.tcp_congestion_control=bbr 2>/dev/null
else
    echo "[*] BBR Di-nonaktifkan, menggunakan TCP Cubic bawaan..."
    sysctl -w net.ipv4.tcp_congestion_control=cubic 2>/dev/null
fi

echo "[*] Mengatur ukuran buffer raksasa agar tidak tersedak dobel request..."
sysctl -w net.ipv4.tcp_rmem="4096 8388608 16777216" 2>/dev/null
sysctl -w net.ipv4.tcp_wmem="4096 8388608 16777216" 2>/dev/null
sysctl -w net.core.rmem_max=16777216 2>/dev/null
sysctl -w net.core.wmem_max=16777216 2>/dev/null
sysctl -w net.core.netdev_max_backlog=50000 2>/dev/null
sysctl -w net.ipv4.tcp_max_syn_backlog=8192 2>/dev/null

# =================================================================
# 🎨 PEMBUATAN BANNER DROPBEAR
# =================================================================
echo "[*] Membuat Banner Dropbear..."
if [ -n "$CUSTOM_BANNER" ]; then
    echo -e "$CUSTOM_BANNER" > /etc/dropbear_banner
else
    cat << 'EOF' > /etc/dropbear_banner
<h2 style="text-align:center";><font color='#a8a6ab'>FREEDOM</font><font color='#00FF1D'> </font><font color='#FFCC00'>𝐓</font><font color='#FFCC00'>𝐔</font><font color='#FFCC00'>𝐍</font><font color='#FFCC00'>𝐍</font><font color='#FFCC00'>𝐄</font><font color='#FFCC00'>𝐋</font><font color='#FFCC00'></font></b><br><br><b><h2 style="text-align:center";><font <font color="aqua">Support Me: https://t.me/xdtoolsxl</font>
EOF
fi

# =================================================================
# 🔒 KONFIGURASI NETWORK & SERVICES (DROPBEAR, STUNNEL, UDPGW)
# =================================================================
SSL_INTERNAL_PORT="2443"

echo "[*] Membuat Sertifikat SSL Stunnel..."
mkdir -p /etc/stunnel /var/run/stunnel4
openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 \
    -subj "/C=ID/ST=Jakarta/L=Jakarta/O=RailwaySSH/CN=localhost" \
    -keyout /etc/stunnel/stunnel.pem -out /etc/stunnel/stunnel.pem 2>/dev/null
chmod 600 /etc/stunnel/stunnel.pem

echo "[*] Memulai Dropbear Server di Port Lokal 22..."
/usr/sbin/dropbear -p 127.0.0.1:22 -b /etc/dropbear_banner -W 1048576 -K 15 -I 300
sleep 1

echo "[*] Mengonfigurasi & Memulai Stunnel di Port 2443..."
cat <<EOF > /etc/stunnel/stunnel.conf
pid = /var/run/stunnel4/stunnel.pid
foreground = no
debug = 0

[ssh-ssl]
accept = 127.0.0.1:$SSL_INTERNAL_PORT
connect = 127.0.0.1:22
cert = /etc/stunnel/stunnel.pem
EOF

rm -f /var/run/stunnel4/stunnel.pid 2>/dev/null
stunnel4 /etc/stunnel/stunnel.conf

# =================================================================
# 🔌 WS-PROXY OPSIONAL (hanya jika file benar-benar ada di image)
# =================================================================
if [ -f /app/ws-proxy.cjs ]; then
    echo "[*] Memulai WS-Proxy untuk SSH Dropbear di Port Lokal 8880 (ws-proxy.cjs)..."
    export WS_PORT="8880"
    nohup node /app/ws-proxy.cjs >/dev/null 2>&1 &
elif [ -f /app/ws-proxy.js ]; then
    echo "[*] Memulai WS-Proxy (legacy ws-proxy.js) di Port 8880..."
    export WS_PORT="8880"
    nohup node /app/ws-proxy.js >/dev/null 2>&1 &
else
    echo "[*] ws-proxy tidak ditemukan — SSH-WS ditangani langsung oleh server.cjs (/ssh-ws path di port 8081)"
fi

# =================================================================
# 🚀 BADVPN UDPGW
# =================================================================
if [ -f /usr/local/bin/badvpn-udpgw ]; then
    echo "[*] Memulai BadVPN udpgw di Port Global ${UDPGW_PORT}..."
    nohup /usr/local/bin/badvpn-udpgw --listen-addr 0.0.0.0:${UDPGW_PORT} --max-clients ${UDPGW_MAX_CLIENTS} --max-connections-for-client 50 >/dev/null 2>&1 &
fi

# =================================================================
# ☁️ TOKEN CLOUDFLARE → DITERUSKAN KE server.cjs (SINGLE OWNER)
# =================================================================
# Perbaikan: JANGAN spawn cloudflared di sini. server.cjs adalah satu-satunya
# pemilik tunnel (agar /api/set-token bisa restart dengan benar).
if [ -n "$TOKEN" ]; then
    echo "[*] TOKEN diteruskan ke server.cjs (single-tunnel manager)..."
    echo "$TOKEN" > /tmp/zt_single_token.txt
else
    echo "[*] TOKEN tidak di-set — server.cjs akan buat Quick Tunnel otomatis."
    rm -f /tmp/zt_single_token.txt 2>/dev/null
fi

sleep 1

# =================================================================
# 🧩 MUX.JS OPSIONAL
# =================================================================
if [ -f /app/mux.cjs ]; then
    echo "[*] Memulai Mux.js di Port 8881 (mux.cjs)..."
    nohup node /app/mux.cjs >/dev/null 2>&1 &
elif [ -f /app/mux.js ]; then
    echo "[*] Memulai Mux.js (legacy mux.js) di Port 8881..."
    nohup node /app/mux.js >/dev/null 2>&1 &
fi

sleep 1

# =================================================================
# 🎯 JALANKAN SERVER UTAMA (CommonJS — .cjs)
# =================================================================
echo "[*] Menjalankan Server Utama UI & Gateway (server.cjs)..."
# PAKSA server.cjs di port 8081 khusus untuk UI, supaya tidak merebut PORT=8881 bawaan Railway
PORT=8081 exec node /app/server.cjs
