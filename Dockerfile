# syntax=docker/dockerfile:1.7

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
 && make -j"$(nproc)" badvpn-udpgw

# =================================================================
# STAGE 2: Frontend React (build → obfuscate → inline)
# =================================================================
FROM node:20-slim AS frontend
WORKDIR /web

# ── 2a) Install SEMUA deps (dev + prod) dengan cache mount ──
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
        npm ci --include=dev --no-audit --no-fund; \
    else \
        npm install --include=dev --no-audit --no-fund; \
    fi

# ── 2b) Copy semua sumber ──
#      ⚠️  Pastikan .dockerignore TIDAK mengecualikan scripts/, src/, public/
COPY . .

# ── 2c) Build Vite + verifikasi output ──
RUN npm run build \
 && echo "=== ls dist/ ===" && ls -la dist/ \
 && echo "=== ls dist/assets/ ===" && ls -la dist/assets/ \
 && test -f dist/index.html \
 || (echo "❌ npm run build gagal / dist/index.html tidak ada" && exit 1)

# ── 2d) Obfuscate JS assets ──
RUN npx --yes javascript-obfuscator@4 ./dist/assets \
    --output ./dist/assets \
    --compact true \
    --string-array true \
    --string-array-encoding base64 \
    --string-array-rotate true \
    --string-array-shuffle true \
    --string-array-threshold 0.75 \
    --split-strings true \
    --split-strings-chunk-length 6 \
    --self-defending false \
    --control-flow-flattening false \
    --dead-code-injection false \
    --identifier-names-generator hexadecimal \
 && echo "=== assets setelah obfuscate ===" && ls -la dist/assets/

# ── 2e) Inline CSS+JS+favicon → frontend.html.cjs ──
RUN node --trace-warnings scripts/inline-html.mjs \
 && echo "=== frontend.html.cjs ===" \
 && ls -la frontend.html.cjs \
 && wc -c frontend.html.cjs

# =================================================================
# STAGE 3: Go Binary (wsproxy)
# =================================================================
FROM --platform=$BUILDPLATFORM golang:1.22-bookworm AS go-builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /build
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download
COPY cmd/ ./cmd/
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -ldflags="-s -w" -o /out/worker ./cmd/wsproxy

# =================================================================
# STAGE 4: Obfuscate server.cjs
# =================================================================
FROM node:20-slim AS obfuscator
WORKDIR /opt
RUN --mount=type=cache,target=/root/.npm \
    npm init -y >/dev/null && \
    npm install javascript-obfuscator@4 --no-audit --no-fund
COPY server.cjs ./server.cjs
RUN npx javascript-obfuscator ./server.cjs \
    --output ./server.cjs \
    --compact true \
    --control-flow-flattening true \
    --control-flow-flattening-threshold 0.4 \
    --dead-code-injection true \
    --dead-code-injection-threshold 0.2 \
    --string-array true \
    --string-array-encoding base64 \
    --string-array-rotate true \
    --string-array-shuffle true \
    --string-array-threshold 0.8 \
    --split-strings true \
    --split-strings-chunk-length 6 \
    --self-defending false \
    --disable-console-output false

# =================================================================
# STAGE 5: Runtime
# =================================================================
FROM ubuntu:22.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=8081
WORKDIR /app

# ── Paket sistem ──
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

# ── Verifikasi modul stream ──
RUN test -f /usr/lib/nginx/modules/ngx_stream_module.so \
    || (echo "❌ modul stream tidak ditemukan!" && exit 1)

# ── Node.js 20 ──
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y nodejs \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Cloudflared (multi-arch) ──
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
        amd64) CF_ARCH=amd64 ;; \
        arm64) CF_ARCH=arm64 ;; \
        *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL -o /usr/local/bin/cloudflared \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
 && chmod +x /usr/local/bin/cloudflared

# =================================================================
# 🔒 RENAME BINARY (anti-detection)
# =================================================================
COPY --from=badvpn-builder /src/badvpn-1.999.130/build/udpgw/badvpn-udpgw /tmp/raw-net
COPY --from=go-builder /out/worker /tmp/raw-stream

RUN cp /usr/sbin/dropbear /usr/local/bin/svc-helper && \
    cp /tmp/raw-net       /usr/local/bin/net-worker && \
    cp /tmp/raw-stream    /usr/local/bin/stream-worker && \
    rm -f /tmp/raw-net /tmp/raw-stream /usr/sbin/dropbear && \
    chmod +x /usr/local/bin/svc-helper /usr/local/bin/net-worker /usr/local/bin/stream-worker

# =================================================================
# 🔑 GENERATE DROPBEAR HOST KEY
# =================================================================
RUN mkdir -p /etc/dropbear && \
    /usr/local/bin/svc-helper -R && \
    test -f /etc/dropbear/dropbear_rsa_host_key \
    && chmod 600 /etc/dropbear/dropbear_rsa_host_key \
    || (echo "❌ Gagal membuat dropbear host key!" && exit 1)

# =================================================================
# Node deps panel
# =================================================================
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
        npm ci --omit=dev --no-audit --no-fund; \
    else \
        npm install --omit=dev --no-audit --no-fund; \
    fi

# ── App code ──
COPY --from=obfuscator /opt/server.cjs ./server.cjs
COPY --from=frontend /web/frontend.html.cjs ./frontend.html.cjs
COPY start.sh ./

# ── Nginx config ──
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/*.conf
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# ── Sertifikat SSL ──
RUN mkdir -p /var/run /var/log/nginx /var/run/dropbear /etc/nginx/ssl \
 && openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
        -subj "/C=ID/ST=Jakarta/L=Jakarta/O=App/CN=app.local" \
        -keyout /etc/nginx/ssl/server.key \
        -out    /etc/nginx/ssl/server.crt \
 && chmod 600 /etc/nginx/ssl/server.key

# ── Validasi nginx ──
RUN nginx -t -c /etc/nginx/nginx.conf 2>&1 || \
    (echo "❌ nginx.conf tidak valid!" && exit 1)

# ── Log ke stdout ──
RUN ln -sf /dev/stdout /var/log/nginx/access.log \
 && ln -sf /dev/stderr /var/log/nginx/error.log \
 && ln -sf /dev/stdout /var/log/nginx/stream_access.log \
 && ln -sf /dev/stderr /var/log/nginx/stream_error.log

RUN chmod +x /app/start.sh

EXPOSE 80 8081 8443
CMD ["bash", "/app/start.sh"]
