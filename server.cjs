#!/usr/bin/env node

const http = require("http");
const url = require("url");
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { exec } = require('child_process');

// ========================================================
// KONFIG GLOBAL
// ========================================================
const FILE_PATH = process.env.FILE_PATH || '.tmp';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.PORT || 8081;
const ARGO_PORT = 8001;
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || 'freedom';

const LOG_PATH = path.join(FILE_PATH, "boot.log");
const ZT_LOG_PATH = "/tmp/named_tunnel.log";
const ZT_SINGLE_TOKEN_FILE = "/tmp/zt_single_token.txt";
const CFIP_FILE = "/tmp/cfip.txt";
const NET_SETTING_FILE = "/tmp/net_settings.json";
const WS_PROXY_CONFIG_FILE = "/tmp/ws_proxy_config.json";
const SYSTEM_CONFIG_FILE = "/tmp/system_config.json";
const ADMIN_PASS_FILE = "/tmp/admin_pass.txt";
const STATS_PATH = "/tmp/server_stats.json";
const DB_PATH = "/tmp/ssh_details.json";
const NODE_LINKS_FILE = "/tmp/node_links.json";

// ========================================================
// EMBEDDED FRONTEND
// ========================================================
let INDEX_HTML = null;
try {
    INDEX_HTML = require('./frontend.html.cjs');
    console.log(`[UI] ✅ Embedded HTML loaded (${(INDEX_HTML.length / 1024).toFixed(1)} KB)`);
} catch (e) {
    console.log('[UI] ⚠️  frontend.html.cjs tidak ditemukan — fallback ke dist/');
}
const DIST_DIR = path.join(__dirname, 'dist');

let cachedDiskUsage = "0%";
let cachedSshOnline = "0 User";
let cachedUserListDetails = "Semua user offline";

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

// ========================================================
// UUID MANAGEMENT
// ========================================================
const UUID_FILE = path.join(FILE_PATH, 'uuid.txt');
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
function getOrCreateUUID() {
    if (process.env.UUID && process.env.UUID.trim()) return process.env.UUID.trim();
    try {
        if (fs.existsSync(UUID_FILE)) {
            const s = fs.readFileSync(UUID_FILE, 'utf8').trim();
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) return s;
        }
    } catch (e) {}
    const u = generateUUID();
    try { fs.writeFileSync(UUID_FILE, u); } catch (e) {}
    return u;
}
let UUID = getOrCreateUUID();

// ========================================================
// CONFIG HELPERS
// ========================================================
function getNetworkSettings() {
    try { if (fs.existsSync(NET_SETTING_FILE)) return JSON.parse(fs.readFileSync(NET_SETTING_FILE, 'utf8')); } catch(e) {}
    return { dns_type: "udp", custom_dns: "8.8.8.8", engine: "httpupgrade" };
}
function saveNetworkSettings(d, c, e) {
    try { fs.writeFileSync(NET_SETTING_FILE, JSON.stringify({ dns_type: d, custom_dns: c, engine: e }, null, 2)); } catch(e) {}
}
function getWsProxyConfig() {
    try { if (fs.existsSync(WS_PROXY_CONFIG_FILE)) return JSON.parse(fs.readFileSync(WS_PROXY_CONFIG_FILE, 'utf8')); } catch (e) {}
    return { sshPort: 22, keepAlive: 15000, maxBuffer: 32768 };
}
function saveWsProxyConfig(sp, ka, mb) {
    try { fs.writeFileSync(WS_PROXY_CONFIG_FILE, JSON.stringify({ sshPort: parseInt(sp)||22, keepAlive: parseInt(ka)||15000, maxBuffer: parseInt(mb)||32768 }, null, 2)); } catch(e) {}
}
function getSystemSettings() {
    try { if (fs.existsSync(SYSTEM_CONFIG_FILE)) return JSON.parse(fs.readFileSync(SYSTEM_CONFIG_FILE, 'utf8')); } catch(e) {}
    return { banner: "", enable_bbr: "true", udpgw_port: "7300", udpgw_max_clients: "1000" };
}
function saveSystemSettings(b, bbr, up, uc) {
    try { fs.writeFileSync(SYSTEM_CONFIG_FILE, JSON.stringify({ banner: b||"", enable_bbr: bbr||"true", udpgw_port: up||"7300", udpgw_max_clients: uc||"1000" }, null, 2)); } catch(e) {}
}
function getActiveCfip() {
    try { if (fs.existsSync(CFIP_FILE)) { const ip = fs.readFileSync(CFIP_FILE,'utf8').trim(); if (ip) return ip; } } catch(e) {}
    return process.env.CFIP || '104.17.3.81';
}
function getAdminPassword() {
    try { if (fs.existsSync(ADMIN_PASS_FILE)) return fs.readFileSync(ADMIN_PASS_FILE, 'utf8').trim(); } catch (e) {}
    return process.env.ADMIN_PASSWORD || null;
}
function verifyAdminPassword(p) { const c = getAdminPassword(); return c && c === p; }
function generateRandomName() {
  const ch = 'abcdefghijklmnopqrstuvwxyz'; let r = '';
  for (let i = 0; i < 6; i++) r += ch.charAt(Math.floor(Math.random() * ch.length));
  return r;
}

let subContent = null;
const webName = generateRandomName();
const botName = generateRandomName();
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');

function loadDb() {
    if (fs.existsSync(DB_PATH)) { try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { return {}; } }
    return {};
}
function saveDb(d) { try { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2)); } catch (e) {} }

let currentActiveDomain = '';

// ========================================================
// TUNNEL MANAGEMENT
// ========================================================
function restartSingleTunnel(newToken) {
    exec("pkill -9 -f 'cloudflared'", () => {
        setTimeout(() => {
            if (newToken && newToken.trim()) {
                fs.writeFileSync(ZT_SINGLE_TOKEN_FILE, newToken.trim());
                exec(`nohup ${botPath} tunnel run --protocol http2 --no-tls-verify --token "${newToken.trim()}" > ${ZT_LOG_PATH} 2>&1 &`);
            } else {
                if (fs.existsSync(ZT_SINGLE_TOKEN_FILE)) fs.unlinkSync(ZT_SINGLE_TOKEN_FILE);
                if (fs.existsSync(ZT_LOG_PATH)) fs.writeFileSync(ZT_LOG_PATH, "Token Dihapus.");
                exec(`nohup ${botPath} tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${LOG_PATH} --loglevel info --url http://localhost:${ARGO_PORT} >/dev/null 2>&1 &`);
            }
        }, 1000);
    });
}

function getDomainsByPort(targetPorts) {
    const domains = [];
    try {
        if (fs.existsSync(ZT_LOG_PATH)) {
            const c = fs.readFileSync(ZT_LOG_PATH, 'utf8');
            const re = new RegExp(`(?:\\\\"|")hostname(?:\\\\"|")\\s*:\\s*(?:\\\\"|")([^"\\\\]+)(?:\\\\"|")[^}]*?localhost:(${targetPorts.join('|')})`, 'g');
            let m;
            while ((m = re.exec(c)) !== null) {
                const d = m[1].trim();
                if (!domains.some(x => x.domain === d)) domains.push({ domain: d, port: m[2] });
            }
        }
    } catch (e) {}
    return domains;
}

function getCurrentHosts() {
    let hwInfo = {};
    if (fs.existsSync(STATS_PATH)) { try { hwInfo = JSON.parse(fs.readFileSync(STATS_PATH,'utf8')); } catch(e){} }
    const ztDomains = getDomainsByPort(['8880', '8881']);
    const namedUrl = ztDomains.length > 0 ? ztDomains[0].domain : (process.env.D || "");
    let hostOutput = "";
    if (namedUrl && !namedUrl.includes("Menghubungkan")) hostOutput += `${namedUrl.replace(/https?:\/\//,'')} (SSH WS)`;
    if (process.env.RAILWAY_TCP_PROXY_DOMAIN && process.env.RAILWAY_TCP_PROXY_PORT) {
        const autoTcp = `${process.env.RAILWAY_TCP_PROXY_DOMAIN}:${process.env.RAILWAY_TCP_PROXY_PORT}`;
        hostOutput += hostOutput ? ` dan (SSH SNI) ${autoTcp}` : `${autoTcp}`;
    } else if (process.env.SNI) {
        hostOutput += hostOutput ? ` dan ${process.env.SNI.replace(/https?:\/\//,'')}` : `${process.env.SNI.replace(/https?:\/\//,'')}`;
    }
    if (!hostOutput) hostOutput = (currentActiveDomain || "Menunggu Quick Tunnel...").replace(/https?:\/\//,'');
    return hostOutput;
}

// ========================================================
// SSH MANAGEMENT
// ========================================================
function listSsh() {
    try {
        const users = []; const dbInfo = loadDb();
        if (!fs.existsSync('/etc/passwd')) return { status: "success", total: 0, users: [] };
        for (const line of fs.readFileSync('/etc/passwd', 'utf8').split('\n')) {
            if (!line.trim()) continue;
            const parts = line.split(':');
            const username = parts[0], uid = parseInt(parts[2], 10);
            if (uid >= 1000 && !["nobody","ubuntu","sshd","dropbear","stunnel"].includes(username)) {
                users.push({ username, uid, shell: parts[parts.length-1], ...(dbInfo[username] || { password: "-", ip: "Unknown", user_agent: "Unknown" }) });
            }
        }
        return { status: "success", total: users.length, users };
    } catch (e) { return { status: "error", message: e.message }; }
}
function addSsh(username, password, ipAddr, userAgent) {
    if (!username || !password) return { status: "error", message: "Username dan password wajib diisi!" };
    if (!/^[a-zA-Z0-9_-]+$/.test(username) || !/^[a-zA-Z0-9_@.-]+$/.test(password))
        return { status: "error", message: "Karakter ilegal!" };
    try {
        exec(`useradd -m -s /bin/bash ${username}`);
        exec(`echo '${username}:${password}' | chpasswd`);
        const db = loadDb(); db[username] = { password, ip: ipAddr, user_agent: userAgent }; saveDb(db);
        const host = getCurrentHosts();
        return { status: "success", message:
            `================================\n       SSH ACCOUNT CREATED      \n================================\n` +
            `Host SSH  : ${host}\nPort TLS  : 443\nPort NTLS : 80\nUsername  : ${username}\nPassword  : ${password}\n` +
            `================================\n powered by : Freedom\n================================` };
    } catch (e) { return { status: "error", message: `Gagal membuat user (mungkin sudah ada).` }; }
}
function deleteSsh(username) {
    if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) return { status: "error", message: "Username ilegal!" };
    try {
        exec(`userdel -r ${username} 2>/dev/null || true`);
        const db = loadDb(); if (db[username]) { delete db[username]; saveDb(db); }
        return { status: "success", message: `User ${username} dihapus!` };
    } catch (e) { return { status: "error", message: `Gagal menghapus user.` }; }
}

// ========================================================
// XRAY CONFIG — DUAL TRANSPORT
// ========================================================
function readPathsFromFile(filename, defaultPath) {
  try {
    if (fs.existsSync(filename)) {
      const paths = fs.readFileSync(filename, 'utf-8').split('\n').map(p => p.trim()).filter(p => p.startsWith('/'));
      if (paths.length > 0) return paths;
    }
  } catch (e) {}
  return [defaultPath];
}

function resolveTransports(engine) {
    if (engine === 'ws' || engine === 'httpupgrade') return ['httpupgrade', 'ws'];
    if (['grpc','h2','tcp'].includes(engine)) return [engine];
    return ['httpupgrade', 'ws'];
}

function resolvePath(basePath, transport, engine) {
    if (transport === engine) return basePath;
    if (transport === 'ws') return basePath + '-ws';
    if (transport === 'httpupgrade') return basePath + '-hu';
    return basePath;
}

async function generateConfig() {
  const netSettings = getNetworkSettings();
  const vlessPaths  = readPathsFromFile('pathvless.txt',  '/vless-argo');
  const vmessPaths  = readPathsFromFile('pathvmess.txt',  '/vmess-argo');
  const trojanPaths = readPathsFromFile('pathtrojan.txt', '/trojan-argo');
  const fallbacksList = [];
  const inboundsList = [];
  let nextPort = 3100;
  const engine = netSettings.engine || 'httpupgrade';
  const transports = resolveTransports(engine);

  function streamSettingsFor(transport, p) {
    switch (transport) {
      case 'grpc': return { network: 'grpc', security: 'none', grpcSettings: { serviceName: 'grpc-service' } };
      case 'h2':   return { network: 'h2', security: 'none', httpSettings: { path: '/h2-path', host: ['localhost'] } };
      case 'tcp':  return { network: 'tcp', security: 'none' };
      case 'httpupgrade': return { network: 'httpupgrade', security: 'none', httpupgradeSettings: { path: p }, alpn: ['http/1.1'] };
      default:     return { network: 'ws', security: 'none', wsSettings: { path: p } };
    }
  }

  const addInbounds = (paths, protocol, buildSettings) => {
    paths.forEach(basePath => {
      transports.forEach(transport => {
        const p = resolvePath(basePath, transport, engine);
        const cp = nextPort++;
        fallbacksList.push({ path: p, dest: cp });
        inboundsList.push({
          port: cp, listen: '127.0.0.1', protocol,
          settings: buildSettings(),
          streamSettings: streamSettingsFor(transport, p),
          sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] }
        });
      });
    });
  };

  addInbounds(vlessPaths,  'vless',  () => ({ clients: [{ id: UUID, level: 0 }], decryption: 'none' }));
  addInbounds(vmessPaths,  'vmess',  () => ({ clients: [{ id: UUID, alterId: 0 }] }));
  addInbounds(trojanPaths, 'trojan', () => ({ clients: [{ password: UUID }] }));

  inboundsList.unshift({
    port: ARGO_PORT, protocol: 'vless',
    settings: { clients: [{ id: UUID }], decryption: 'none', fallbacks: fallbacksList },
    streamSettings: { network: 'tcp', security: 'none' },
    sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] }
  });

  let dnsValue = (netSettings.custom_dns || '').trim();
  let dnsServers = [];
  if (netSettings.dns_type === 'doh') {
    if (!dnsValue.startsWith('http')) dnsValue = 'https://1.1.1.1/dns-query';
    dnsServers = [dnsValue, '8.8.8.8'];
  } else {
    if (!dnsValue || dnsValue.startsWith('http')) dnsValue = '8.8.8.8';
    dnsServers = [dnsValue, '1.1.1.1'];
  }

  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: inboundsList,
    dns: { servers: dnsServers },
    outbounds: [{ protocol: 'freedom', tag: 'direct' }]
  };
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
  console.log(`[Xray] Config generated (${transports.join('+')}) → ${inboundsList.length} inbounds`);
}

// ========================================================
// DOWNLOAD & RUN
// ========================================================
function getSystemArchitecture() { return os.arch().includes('arm') ? 'arm' : 'amd'; }

function downloadFile(fileName, fileUrl, callback) {
  if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });
  const writer = fs.createWriteStream(fileName);
  axios({ method: 'get', url: fileUrl, responseType: 'stream' }).then(r => {
    r.data.pipe(writer);
    writer.on('finish', () => { writer.close(); callback(null, fileName); });
    writer.on('error', err => { fs.unlink(fileName, () => {}); callback(err.message); });
  }).catch(err => callback(err.message));
}

async function downloadFilesAndRun() {
  const arch = getSystemArchitecture();
  const base = arch === 'arm' ? 'https://arm64.ssss.nyc.mn' : 'https://amd64.ssss.nyc.mn';
  for (const f of [{ f: webPath, u: `${base}/web` }, { f: botPath, u: `${base}/bot` }]) {
    await new Promise((res, rej) => downloadFile(f.f, f.u, err => err ? rej(err) : res()));
  }
  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);
  exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);

  const startTunnel = (token) => {
    if (token) restartSingleTunnel(token);
    else exec(`nohup ${botPath} tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${LOG_PATH} --loglevel info --url http://localhost:${ARGO_PORT} >/dev/null 2>&1 &`);
  };
  if (fs.existsSync(ZT_SINGLE_TOKEN_FILE)) {
    const t = fs.readFileSync(ZT_SINGLE_TOKEN_FILE, 'utf8').trim();
    startTunnel(t || null);
  } else startTunnel(null);
  await new Promise(r => setTimeout(r, 5000));
}

async function extractDomains() {
  try {
    if (fs.existsSync(LOG_PATH)) {
      const m = fs.readFileSync(LOG_PATH, 'utf-8').match(/https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
      if (m && m[1] !== currentActiveDomain) {
        currentActiveDomain = m[1];
        await generateLinks(currentActiveDomain);
      }
    }
  } catch (e) {}
}

async function getMetaInfo() {
  try { const r = await axios.get('https://api.ip.sb/geoip'); return `${r.data.country_code}-${r.data.isp}`.replace(/\s+/g, '_'); }
  catch(e) { return 'RailwayServer'; }
}

// ========================================================
// GENERATE LINKS
// ========================================================
async function generateLinks(argoDomain) {
  const netSettings = getNetworkSettings();
  const engine = netSettings.engine || 'httpupgrade';
  const transports = resolveTransports(engine);
  const ISP = await getMetaInfo();
  const nodeName = `${NAME}-${ISP}`;
  const activeCfip = getActiveCfip();
  const baseVless  = readPathsFromFile('pathvless.txt',  '/vless-argo')[0];
  const baseVmess  = readPathsFromFile('pathvmess.txt',  '/vmess-argo')[0];
  const baseTrojan = readPathsFromFile('pathtrojan.txt', '/trojan-argo')[0];

  const buildLinks = (protocol, basePath) => {
    const out = {};
    transports.forEach(transport => {
      const p = resolvePath(basePath, transport, engine);
      const label = `${nodeName}-${protocol.toUpperCase()}-${transport.toUpperCase()}`;
      const enc = encodeURIComponent;

      if (protocol === 'vless') {
        if (transport === 'httpupgrade')
          out.httpupgrade = `vless://${UUID}@${activeCfip}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&type=httpupgrade&host=${argoDomain}&path=${enc(p)}&alpn=http%2F1.1#${enc(label)}`;
        else if (transport === 'ws')
          out.ws = `vless://${UUID}@${activeCfip}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&type=ws&host=${argoDomain}&path=${enc(p)}#${enc(label)}`;
        else
          out[transport] = `vless://${UUID}@${activeCfip}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&type=${transport}&host=${argoDomain}&path=${enc(p)}#${enc(label)}`;
      } else if (protocol === 'vmess') {
        const o = { v:"2", ps: label, add: activeCfip, port: String(CFPORT), id: UUID, aid:"0", scy:"auto", net: transport, type:"none", host: argoDomain, path: p, tls:"tls", sni: argoDomain };
        if (transport === 'httpupgrade') o.alpn = "http/1.1";
        out[transport] = `vmess://${Buffer.from(JSON.stringify(o)).toString('base64')}`;
      } else if (protocol === 'trojan') {
        if (transport === 'httpupgrade')
          out.httpupgrade = `trojan://${UUID}@${activeCfip}:${CFPORT}?security=tls&sni=${argoDomain}&type=httpupgrade&host=${argoDomain}&path=${enc(p)}&alpn=http%2F1.1#${enc(label)}`;
        else if (transport === 'ws')
          out.ws = `trojan://${UUID}@${activeCfip}:${CFPORT}?security=tls&sni=${argoDomain}&type=ws&host=${argoDomain}&path=${enc(p)}#${enc(label)}`;
        else
          out[transport] = `trojan://${UUID}@${activeCfip}:${CFPORT}?security=tls&sni=${argoDomain}&type=${transport}&host=${argoDomain}&path=${enc(p)}#${enc(label)}`;
      }
    });
    return out;
  };

  const linksData = {
    vless:  buildLinks('vless',  baseVless),
    vmess:  buildLinks('vmess',  baseVmess),
    trojan: buildLinks('trojan', baseTrojan)
  };

  try { fs.writeFileSync(NODE_LINKS_FILE, JSON.stringify(linksData, null, 2)); } catch(e) {}

  const all = [...Object.values(linksData.vless), ...Object.values(linksData.vmess), ...Object.values(linksData.trojan)].filter(Boolean);
  subContent = Buffer.from(all.join('\n')).toString('base64');
  fs.writeFileSync(subPath, subContent);
}

// ========================================================
// INFO PAGE RENDERER
// ========================================================
function renderInfoPage(protocol, links, argoDomain) {
  const rows = Object.entries(links).filter(([_, v]) => v).map(([transport, link]) => {
    const isHu = transport === 'httpupgrade';
    const label = isHu ? '📡 HTTPUpgrade (Recommended)' : (transport === 'ws' ? '🔌 WebSocket' : `⚙️ ${transport.toUpperCase()}`);
    const cls = isHu ? 'card primary' : 'card';
    return `<div class="${cls}">
      <div class="label">${label}</div>
      <textarea readonly rows="4">${link.replace(/</g,'&lt;')}</textarea>
      <button class="copy-btn" onclick="copyText(this)">📋 Copy</button>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${protocol.toUpperCase()} — Node Info</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0e27;color:#e4e6eb;margin:0;padding:20px;min-height:100vh}
  .container{max-width:720px;margin:0 auto} h1{color:#58a6ff;font-size:24px;margin:0 0 16px}
  .meta{background:#161b22;padding:14px;border-radius:10px;margin-bottom:20px;font-size:14px;line-height:1.8}
  .meta strong{color:#8b949e;display:inline-block;width:80px}
  .meta span{color:#58a6ff;font-family:monospace;word-break:break-all}
  .card{background:#161b22;padding:16px;border-radius:10px;margin-bottom:14px;border-left:4px solid #30363d}
  .card.primary{border-left-color:#3fb950}
  .label{color:#58a6ff;font-weight:600;margin-bottom:10px;font-size:14px}
  textarea{width:100%;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:8px;padding:12px;font-family:'SF Mono',Consolas,monospace;font-size:12px;resize:vertical;line-height:1.5}
  textarea:focus{outline:none;border-color:#58a6ff}
  .copy-btn{background:#238636;color:white;border:0;padding:10px 18px;border-radius:8px;cursor:pointer;margin-top:10px;font-weight:600;font-size:13px;transition:all .2s}
  .copy-btn:hover{background:#2ea043;transform:translateY(-1px)}
  .copy-btn.done{background:#1f6feb}
  .footer{text-align:center;color:#484f58;font-size:12px;margin-top:32px;padding-top:20px;border-top:1px solid #21262d}
  .badge{display:inline-block;background:#1f6feb;color:white;padding:2px 10px;border-radius:20px;font-size:11px;margin-left:8px;font-weight:600}
</style>
</head><body>
<div class="container">
  <h1>🔐 ${protocol.toUpperCase()} NODE <span class="badge">DUAL</span></h1>
  <div class="meta">
    <div><strong>Server:</strong> <span>${argoDomain || 'N/A'}</span></div>
    <div><strong>CFIP:</strong> <span>${getActiveCfip()}</span></div>
    <div><strong>Port:</strong> <span>${CFPORT}</span></div>
  </div>
  ${rows}
  <div class="footer">powered by : Freedom<br><small style="color:#30363d">HTTPUpgrade + WebSocket support</small></div>
</div>
<script>
function copyText(btn){
  const ta = btn.previousElementSibling;
  ta.select(); document.execCommand('copy');
  btn.textContent = '✅ Copied!'; btn.classList.add('done');
  setTimeout(() => { btn.textContent = '📋 Copy'; btn.classList.remove('done'); }, 1500);
}
</script>
</body></html>`;
}

// ========================================================
// STATIC FILES (fallback dev)
// ========================================================
const MIME_TYPES = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8' };
function serveStaticFile(reqPath, res) {
  let fp = path.join(DIST_DIR, reqPath);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(fp)) { res.writeHead(404,{'Content-Type':'text/plain'}); return res.end("Not Found"); }
  res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
}
function sendIndexHtml(res) {
  if (INDEX_HTML) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(INDEX_HTML);
  }
  return serveStaticFile('index.html', res);
}

// ========================================================
// HTTP SERVER
// ========================================================
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathName = parsedUrl.pathname;
    const query = parsedUrl.query;
    const ipAddr = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || "Unknown IP";
    const userAgent = req.headers['user-agent'] || "Unknown UA";
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Subscription
    if (pathName === `/${SUB_PATH}`) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(subContent || (fs.existsSync(subPath) ? fs.readFileSync(subPath, 'utf-8') : 'Loading sub...'));
    }

    // INFO PAGES (non-upgrade request)
    if (!req.headers.upgrade) {
        const infoMap = { '/vless-argo': 'vless', '/vmess-argo': 'vmess', '/trojan-argo': 'trojan' };
        const proto = infoMap[pathName];
        if (proto) {
            let linksData = {};
            try { if (fs.existsSync(NODE_LINKS_FILE)) linksData = JSON.parse(fs.readFileSync(NODE_LINKS_FILE, 'utf8')); } catch(e) {}
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(renderInfoPage(proto, linksData[proto] || {}, currentActiveDomain));
        }
    }

    if (pathName === '/__info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            uuid: UUID, cfip: getActiveCfip(),
            domain: currentActiveDomain || "Menunggu...",
            paths: {
                vless: readPathsFromFile('pathvless.txt','/vless-argo')[0],
                vmess: readPathsFromFile('pathvmess.txt','/vmess-argo')[0],
                trojan: readPathsFromFile('pathtrojan.txt','/trojan-argo')[0]
            }
        }));
    }

    if (pathName === '/api/logtunnel') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH,'utf8') : "Log belum siap.");
    }
    if (pathName === '/api/lognamed') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(fs.existsSync(ZT_LOG_PATH) ? fs.readFileSync(ZT_LOG_PATH,'utf8') : "Log Zero Trust belum ada.");
    }
    if (pathName === '/api/setup-pass') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const newPass = (query.pass||'').trim(), oldPass = (query.old_pass||'').trim(), cur = getAdminPassword();
        if (cur && oldPass !== cur) return res.end(JSON.stringify({ status:"error", message:"Password Admin Lama Salah!" }));
        if (!newPass || newPass.length < 4) return res.end(JSON.stringify({ status:"error", message:"Password minimal 4 karakter!" }));
        fs.writeFileSync(ADMIN_PASS_FILE, newPass);
        return res.end(JSON.stringify({ status:"success", message:"Password Admin Berhasil Disimpan!" }));
    }
    if (pathName === '/api/set-network') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) return res.end(JSON.stringify({ status:"error", message:"Akses Ditolak!" }));
        const dns_type = query.dns_type || "udp";
        const custom_dns = query.custom_dns ? decodeURIComponent(query.custom_dns) : "8.8.8.8";
        const engine = query.engine || "httpupgrade";
        saveNetworkSettings(dns_type, custom_dns, engine);
        await generateConfig();
        exec(`pkill -9 -f '${webName}'`, () => {
            setTimeout(() => exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`), 1000);
        });
        if (currentActiveDomain) generateLinks(currentActiveDomain);
        return res.end(JSON.stringify({ status:"success", message:`Setting V2Ray Disimpan! DNS: [${dns_type.toUpperCase()}] ${custom_dns}, Engine: ${engine.toUpperCase()}.` }));
    }
    if (pathName === '/api/set-wsproxy') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) return res.end(JSON.stringify({ status:"error", message:"Akses Ditolak!" }));
        saveWsProxyConfig(query.ssh_port, query.keep_alive, query.max_buffer);
        return res.end(JSON.stringify({ status:"success", message:`Setting SSH Disimpan!` }));
    }
    if (pathName === '/api/set-system') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) return res.end(JSON.stringify({ status:"error", message:"Akses Ditolak!" }));
        const banner = query.banner ? decodeURIComponent(query.banner) : "";
        const enable_bbr = query.enable_bbr || "true";
        const udpgw_port = query.udpgw_port || "7300";
        const udpgw_max_clients = query.udpgw_max_clients || "1000";
        saveSystemSettings(banner, enable_bbr, udpgw_port, udpgw_max_clients);
        try { fs.writeFileSync('/etc/dropbear_banner', banner || "=== SSH SERVER PANEL ===\n powered by : Freedom\n=========================\n"); } catch(e) {}
        exec("pkill -9 dropbear", () => {
            setTimeout(() => {
                const sshPort = getWsProxyConfig().sshPort || 22;
                exec(`/usr/sbin/dropbear -p 127.0.0.1:${sshPort} -b /etc/dropbear_banner -W 1048576 -K 15 -I 300`);
            }, 1000);
        });
        exec("pkill -9 badvpn-udpgw", () => {
            setTimeout(() => {
                if (fs.existsSync('/usr/local/bin/badvpn-udpgw'))
                    exec(`nohup /usr/local/bin/badvpn-udpgw --listen-addr 0.0.0.0:${udpgw_port} --max-clients ${udpgw_max_clients} --max-connections-for-client 50 >/dev/null 2>&1 &`);
            }, 1000);
        });
        try { exec(enable_bbr === "true" ? "sysctl -w net.ipv4.tcp_congestion_control=bbr 2>/dev/null" : "sysctl -w net.ipv4.tcp_congestion_control=cubic 2>/dev/null"); } catch(e) {}
        return res.end(JSON.stringify({ status:"success", message:`System Config disimpan!` }));
    }
    if (pathName === '/api/set-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) return res.end(JSON.stringify({ status:"error", message:"Akses Ditolak!" }));
        if (query.token !== undefined) restartSingleTunnel(query.token.trim());
        return res.end(JSON.stringify({ status:"success", message:"Restart tunnel terkirim!" }));
    }
    if (pathName === '/api/set-cfip') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) return res.end(JSON.stringify({ status:"error", message:"Akses Ditolak!" }));
        const newIp = (query.ip||'').trim();
        if (newIp) { fs.writeFileSync(CFIP_FILE, newIp); if (currentActiveDomain) generateLinks(currentActiveDomain); return res.end(JSON.stringify({ status:"success", message:`CFIP → ${newIp}` })); }
        if (fs.existsSync(CFIP_FILE)) fs.unlinkSync(CFIP_FILE);
        return res.end(JSON.stringify({ status:"success", message:"CFIP Direset." }));
    }
    if (pathName === '/api/add')    { res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify(addSsh(query.user, query.pass, ipAddr, userAgent))); }
    if (pathName === '/api/delete') { res.writeHead(200,{'Content-Type':'application/json'}); if (!verifyAdminPassword(query.token)) return res.end(JSON.stringify({ status:"error", message:"Akses Ditolak!" })); return res.end(JSON.stringify(deleteSsh(query.user))); }
    if (pathName === '/api/list')   { res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify(listSsh())); }
    if (pathName === '/api/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (getAdminPassword() === null) return res.end(JSON.stringify({ status:"not_configured", message:"Password Admin belum dibuat!" }));
        return res.end(JSON.stringify(verifyAdminPassword(query.pass) ? { status:"success", token: query.pass } : { status:"error", message:"Password Salah!" }));
    }
    if (pathName === '/api/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let hwInfo = {
            cpu_model: os.cpus()[0] ? os.cpus()[0].model : "Unknown",
            ram_total: (os.totalmem()/1024/1024/1024).toFixed(2)+" GB",
            ram_used: ((os.totalmem()-os.freemem())/1024/1024/1024).toFixed(2)+" GB",
            disk_usage: cachedDiskUsage,
            uptime: (os.uptime()/3600).toFixed(2)+" Hours",
            ssh_online: cachedSshOnline,
            user_list_details: cachedUserListDetails
        };
        if (fs.existsSync(STATS_PATH)) { try { hwInfo = { ...hwInfo, ...JSON.parse(fs.readFileSync(STATS_PATH,'utf8')) }; } catch(e) {} }
        const netSettings = getNetworkSettings();
        const wsProxyCfg = getWsProxyConfig();
        const sysSettings = getSystemSettings();
        const rlwyPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || "";
        const rlwyTcpDomain = (process.env.RAILWAY_TCP_PROXY_DOMAIN && process.env.RAILWAY_TCP_PROXY_PORT)
            ? `${process.env.RAILWAY_TCP_PROXY_DOMAIN}:${process.env.RAILWAY_TCP_PROXY_PORT}`
            : (process.env.SNI ? process.env.SNI.replace(/https?:\/\//,'') : "Tidak Aktif");
        return res.end(JSON.stringify({
            active_cfip: getActiveCfip(),
            quick_url: currentActiveDomain || "Menunggu Quick Tunnel...",
            zt_domains: getDomainsByPort(['8880','8881']),
            zt_vmess_domains: getDomainsByPort(['8001']),
            pass_configured: getAdminPassword() !== null,
            railway_public: rlwyPublicDomain || "Tidak Aktif",
            railway_sni: rlwyTcpDomain,
            status: "ONLINE",
            dns_type: netSettings.dns_type,
            custom_dns: netSettings.custom_dns,
            engine_mode: netSettings.engine,
            ws_proxy_cfg: wsProxyCfg,
            sys_settings: sysSettings,
            ...hwInfo,
            ssh_online: String(hwInfo.ssh_online).replace(/👥/g,'').replace(/Active/g,'').replace(/Users/g,'').trim() || "0"
        }));
    }

    if (pathName === '/' || pathName === '/index.html') return sendIndexHtml(res);
    if (!pathName.startsWith('/api/') && !pathName.startsWith('/__')) return sendIndexHtml(res);

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end("Not Found");
});

// ========================================================
// WS / HTTPUPGRADE FORWARDER
// ========================================================
function forwardWebsocket(targetPort, req, socket, head) {
    const net = require('net');
    const targetConn = net.createConnection({ port: targetPort, host: '127.0.0.1' }, () => {
        let rawHeaders = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) rawHeaders += `${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}\r\n`;
        rawHeaders += '\r\n';
        targetConn.write(rawHeaders);
        if (head && head.length > 0) targetConn.write(head);
        socket.pipe(targetConn);
        targetConn.pipe(socket);
    });
    targetConn.on('error', () => { try { socket.destroy(); } catch(e){} });
    socket.on('error', () => { try { targetConn.destroy(); } catch(e){} });
}

server.on('upgrade', (req, socket, head) => {
    const urlPath = req.url.split('?')[0];
    if (urlPath === '/ssh-ws' || urlPath.startsWith('/ssh')) {
        const wsCfg = getWsProxyConfig();
        return forwardWebsocket(wsCfg.sshPort || 22, req, socket, head);
    }
    return forwardWebsocket(ARGO_PORT, req, socket, head);
});

// ========================================================
// START
// ========================================================
server.listen(PORT, () => {
    console.log(`[Engine] Running on :${PORT} | UUID: ${UUID}`);
    generateConfig().then(() => downloadFilesAndRun()).then(() => extractDomains()).catch(e => console.error(e));

    if (fs.existsSync(ZT_SINGLE_TOKEN_FILE)) {
        try { const t = fs.readFileSync(ZT_SINGLE_TOKEN_FILE,'utf8').trim(); if (t) restartSingleTunnel(t); } catch(e) {}
    }

    setInterval(() => extractDomains(), 3000);
    setInterval(() => {
        exec("df -h / | awk 'NR==2 {print $5}'", (err, out) => { if (!err && out.trim()) cachedDiskUsage = out.trim(); });
        exec("netstat -anp 2>/dev/null | grep dropbear | grep ESTABLISHED | awk '{print $5}' | cut -d: -f1 | sort -u", (err, out) => {
            if (!err && out.trim()) {
                const ips = out.trim().split('\n').filter(Boolean);
                if (ips.length > 0) { cachedSshOnline = "1 User"; cachedUserListDetails = `IP Active: ${ips[0]}`; }
                else { cachedSshOnline = "0 User"; cachedUserListDetails = "Semua user offline"; }
            } else { cachedSshOnline = "0 User"; cachedUserListDetails = "Semua user offline"; }
        });
    }, 4000);
});
