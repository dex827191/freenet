
# =================================================================
# STAGE 1: BUILDER - BADVPN UDPGW
# =================================================================
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    cmake \
    make \
    gcc \
    g++ \
    curl \
    tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

RUN curl -fsSL https://github.com/ambrop72/badvpn/archive/refs/tags/1.999.130.tar.gz \
    | tar -xz \
    && cd badvpn-1.999.130 \
    && mkdir build \
    && cd build \
    && cmake .. -DBUILD_NOTHING_BY_DEFAULT=1 -DBUILD_UDPGW=1 \
    && make badvpn-udpgw

# =================================================================
# STAGE 2: FRONTEND - REACT + VITE
# =================================================================
FROM node:20-slim AS frontend

WORKDIR /web

COPY package.json package-lock.json* ./

RUN npm ci || npm install

COPY . .

RUN npm run build

# =================================================================
# STAGE 3: RUNTIME
# =================================================================
FROM ubuntu:22.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=8081

WORKDIR /app

# -------------------------------------------------
# Install system dependencies
# -------------------------------------------------
RUN apt-get update && apt-get install -y \
    curl \
    dropbear \
    stunnel4 \
    openssl \
    ca-certificates \
    procps \
    psmisc \
    net-tools \
    iproute2 \
    bash \
    jq \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# -------------------------------------------------
# Install Cloudflared
# -------------------------------------------------
RUN curl -fsSL \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared

# -------------------------------------------------
# Install BadVPN UDPGW
# -------------------------------------------------
COPY --from=builder \
    /src/badvpn-1.999.130/build/udpgw/badvpn-udpgw \
    /usr/local/bin/badvpn-udpgw

RUN chmod +x /usr/local/bin/badvpn-udpgw

# -------------------------------------------------
# Copy package files and install dependencies
# -------------------------------------------------
COPY package.json package-lock.json* ./

RUN npm install --omit=dev

# -------------------------------------------------
# IMPORTANT: Copy ALL repository files
# -------------------------------------------------
COPY . .

# -------------------------------------------------
# Copy compiled frontend
# -------------------------------------------------
COPY --from=frontend /web/dist ./dist

# -------------------------------------------------
# Verify required files
# -------------------------------------------------
RUN echo "========== APP FILES ==========" \
    && ls -lah /app \
    && echo "========== REQUIRED FILES ==========" \
    && test -f /app/server.cjs \
    && test -f /app/start.sh \
    && test -f /app/ws-proxy.cjs \
    && test -f /app/mux.cjs \
    && echo "All required files found!"

# -------------------------------------------------
# Permissions
# -------------------------------------------------
RUN chmod +x /app/start.sh \
    && chmod +x /usr/local/bin/badvpn-udpgw \
    && chmod +x /usr/local/bin/cloudflared

EXPOSE 8081

CMD ["bash", "/app/start.sh"]
