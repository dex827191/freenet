# =================================================================
# STAGE 1: Builder BadVPN (UDP Gateway)
# =================================================================
FROM ubuntu:22.04 AS badvpn-builder
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y cmake make gcc g++ curl tar \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL https://github.com/ambrop72/badvpn/archive/refs/tags/1.999.130.tar.gz | tar -xz \
 && cd badvpn-1.999.130 && mkdir build && cd build \
 && cmake .. -DBUILD_NOTHING_BY_DEFAULT=1 -DBUILD_UDPGW=1 \
 && make badvpn-udpgw

# =================================================================
# STAGE 2: Frontend React (Vite build)
# =================================================================
FROM node:20-slim AS frontend
WORKDIR /web
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# =================================================================
# STAGE 3: Go Binaries (wsproxy — mux DIHAPUS, digantikan Nginx)
# =================================================================
FROM golang:1.22-bookworm AS go-builder
WORKDIR /build
COPY go.mod go.sum* ./
COPY cmd/ ./cmd/
# Hanya build wsproxy. Kalau folder cmd/mux sudah dihapus, ini tidak error.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/wsproxy ./cmd/wsproxy

# =================================================================
# STAGE 4: Runtime — Ubuntu 22.04 + nginx-full (modul stream ON)
# =================================================================
FROM ubuntu:22.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=8081
WORKDIR /app

# ── Paket sistem ──
# ⚠️ nginx-full: WAJIB, karena paket "nginx" biasa TIDAK ada modul stream
RUN apt-get update && apt-get install -y \
    dropbear \
    nginx-full \
    openssl \
    ca-certificates \
    procps psmisc net-tools iproute2 \
    bash jq sudo \
    curl wget \
    && rm -rf /var/lib/apt/lists/*

# ── Verifikasi modul stream aktif saat build (gagal build kalau tidak ada) ──
RUN nginx -V 2>&1 | grep -q -- '--with-stream' \
    || (echo "❌ Nginx tidak punya modul stream! Cek paket nginx-full." && exit 1)

# ── Node.js 20 (untuk panel UI server.cjs) ──
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y nodejs \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Cloudflared (tunnel ke panel/xray) ──
RUN curl -fsSL -o /usr/local/bin/cloudflared \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
 && chmod +x /usr/local/bin/cloudflared

# ── BadVPN dari builder ──
COPY --from=badvpn-builder \
     /src/badvpn-1.999.130/build/udpgw/badvpn-udpgw \
     /usr/local/bin/badvpn-udpgw
RUN chmod +x /usr/local/bin/badvpn-udpgw

# ── WSProxy dari Go builder ──
COPY --from=go-builder /out/wsproxy /usr/local/bin/wsproxy
RUN chmod +x /usr/local/bin/wsproxy

# ── Dependensi Node panel ──
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ── App code ──
COPY server.cjs start.sh ./
COPY --from=frontend /web/dist ./dist

# ── Nginx config ──
# Hapus default config Ubuntu yang bisa konflik dengan config kita
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/*.conf
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# ── Siapkan folder & sertifikat self-signed untuk SNI bug ──
RUN chmod +x /app/start.sh \
 && mkdir -p /var/run /var/log/nginx /var/run/dropbear /etc/dropbear /etc/nginx/ssl \
 && openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
        -subj "/C=ID/ST=Jakarta/L=Jakarta/O=RailwaySSH/CN=bug.com" \
        -keyout /etc/nginx/ssl/server.key \
        -out    /etc/nginx/ssl/server.crt \
 && chmod 600 /etc/nginx/ssl/server.key \
 && ln -sf /dev/stdout /var/log/nginx/access.log \
 && ln -sf /dev/stderr /var/log/nginx/error.log \
 && ln -sf /dev/stdout /var/log/nginx/stream_access.log \
 && ln -sf /dev/stderr /var/log/nginx/stream_error.log

# ── Expose port (info saja — Railway pakai TCP Proxy) ──
# 80    : HTTP panel (via Railway Public Domain)
# 8081  : Node panel (internal)
# 8443  : Nginx stream multiplexer (expose via Railway TCP Proxy)
# 2443  : Nginx TLS terminator (internal, dari 8443)
# 8880  : WS Proxy (internal, dari 8443)
# 22    : Dropbear (internal, dari 8443/2443/8880)
EXPOSE 80 8081 8443

# ── Entrypoint ──
CMD ["bash", "/app/start.sh"]
