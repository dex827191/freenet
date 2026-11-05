# =================================================================
# STAGE 1: Builder BadVPN
# =================================================================
FROM ubuntu:22.04 AS builder
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
# STAGE 3: Runtime
# =================================================================
FROM ubuntu:22.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=8081
WORKDIR /app

# Deps sistem + Go toolchain sementara
RUN apt-get update && apt-get install -y \
    dropbear stunnel4 openssl ca-certificates \
    procps psmisc net-tools iproute2 bash jq sudo \
    curl cmake make gcc g++ git \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://go.dev/dl/go1.22.5.linux-amd64.tar.gz | tar -C /usr/local -xz
ENV PATH=$PATH:/usr/local/go/bin

# Compile Go binaries (mux + wsproxy)
COPY go.mod ./
COPY cmd/ ./cmd/
RUN go build -ldflags="-s -w" -o /usr/local/bin/mux ./cmd/mux \
 && go build -ldflags="-s -w" -o /usr/local/bin/wsproxy ./cmd/wsproxy \
 && rm -rf /root/go /usr/local/go

# BadVPN
COPY --from=builder /src/badvpn-1.999.130/build/udpgw/badvpn-udpgw /usr/local/bin/badvpn-udpgw
RUN chmod +x /usr/local/bin/badvpn-udpgw

# Cloudflared
RUN curl -fsSL -o /usr/local/bin/cloudflared \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
 && chmod +x /usr/local/bin/cloudflared

# Node.js untuk panel UI (server.cjs)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y nodejs \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Dependensi Node panel
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy app + frontend build
COPY server.cjs start.sh ./
COPY --from=frontend /web/dist ./dist

RUN chmod +x /app/start.sh \
 && mkdir -p /var/run/dropbear /var/run/stunnel /etc/dropbear \
 && openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 \
    -subj "/C=ID/ST=Jakarta/L=Jakarta/O=RailwaySSH/CN=localhost" \
    -keyout /etc/stunnel/stunnel.pem -out /etc/stunnel/stunnel.pem

EXPOSE 8081 8880 8881
CMD ["bash", "/app/start.sh"]
