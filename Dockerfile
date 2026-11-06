# =================================================================
# STAGE 1: Builder BadVPN
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
# STAGE 2: Frontend React
# =================================================================
FROM node:20-slim AS frontend
WORKDIR /web
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# =================================================================
# STAGE 3: Go Binary (wsproxy)
# =================================================================
FROM golang:1.22-bookworm AS go-builder
WORKDIR /build
COPY go.mod go.sum* ./
COPY cmd/ ./cmd/
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/wsproxy ./cmd/wsproxy

# =================================================================
# STAGE 4: Runtime
# =================================================================
FROM ubuntu:22.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=8081
WORKDIR /app

# ── Paket sistem (nginx-full + libnginx-mod-stream) ──
RUN apt-get update && apt-get install -y \
    dropbear \
    nginx-full \
    libnginx-mod-stream \
    openssl \
    ca-certificates \
    procps psmisc net-tools iproute2 \
    bash jq sudo \
    curl wget \
    && rm -rf /var/lib/apt/lists/*

# ── Verifikasi file modul stream (dynamic module) ──
RUN test -f /usr/lib/nginx/modules/ngx_stream_module.so \
    || (echo "❌ ngx_stream_module.so tidak ditemukan!" && exit 1)

# ── Node.js 20 ──
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y nodejs \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Cloudflared ──
RUN curl -fsSL -o /usr/local/bin/cloudflared \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
 && chmod +x /usr/local/bin/cloudflared

# ── BadVPN ──
COPY --from=badvpn-builder \
     /src/badvpn-1.999.130/build/udpgw/badvpn-udpgw \
     /usr/local/bin/badvpn-udpgw
RUN chmod +x /usr/local/bin/badvpn-udpgw

# ── WSProxy ──
COPY --from=go-builder /out/wsproxy /usr/local/bin/wsproxy
RUN chmod +x /usr/local/bin/wsproxy

# ── Node deps panel ──
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ── App code ──
COPY server.cjs start.sh ./
COPY --from=frontend /web/dist ./dist

# ── Nginx config ──
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/*.conf
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# ── Sertifikat SSL + folder log (simpel, sebelum validasi nginx) ──
RUN mkdir -p /var/run /var/log/nginx /var/run/dropbear /etc/dropbear /etc/nginx/ssl \
 && openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
        -subj "/C=ID/ST=Jakarta/L=Jakarta/O=RailwaySSH/CN=bug.com" \
        -keyout /etc/nginx/ssl/server.key \
        -out    /etc/nginx/ssl/server.crt \
 && chmod 600 /etc/nginx/ssl/server.key

# ── ✅ VALIDASI SYNTAX NGINX SAAT BUILD ──
# Kalau ada typo di nginx.conf, build GAGAL di sini (bukan nunggu runtime)
RUN nginx -t -c /etc/nginx/nginx.conf 2>&1 || \
    (echo "❌ nginx.conf tidak valid! Cek syntax di atas." && exit 1)

# ── Log nginx ke stdout/stderr Railway ──
RUN ln -sf /dev/stdout /var/log/nginx/access.log \
 && ln -sf /dev/stderr /var/log/nginx/error.log \
 && ln -sf /dev/stdout /var/log/nginx/stream_access.log \
 && ln -sf /dev/stderr /var/log/nginx/stream_error.log

# ── Permission & entrypoint ──
RUN chmod +x /app/start.sh

EXPOSE 80 8081 8443
CMD ["bash", "/app/start.sh"]
