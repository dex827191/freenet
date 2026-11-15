'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ========================================================
// DATA DIR (auto-detect writable, prioritas /app/data)
// ========================================================
const DATA_DIR = (() => {
  const candidates = [
    process.env.DATA_DIR,
    '/app/data',
    '/data',
    process.env.FILE_PATH,
    '.tmp',
  ].filter(Boolean);

  for (const d of candidates) {
    try {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      fs.accessSync(d, fs.constants.W_OK);
      return d;
    } catch (_) {}
  }
  console.warn('[SSH-STORE] ⚠️  Tidak ada direktori writable, fallback /tmp (TIDAK PERSISTEN!)');
  return '/tmp';
})();

const DB_PATH = path.join(DATA_DIR, 'ssh_accounts.json');
const DB_BACKUP = DB_PATH + '.bak';
const DB_TEMP_PREFIX = DB_PATH + '.tmp.';

console.log(`[SSH-STORE] 📁 Data dir: ${DATA_DIR}`);
console.log(`[SSH-STORE] 📄 DB path : ${DB_PATH}`);
console.log(`[SSH-STORE] ⚠️  Mode: PLAINTEXT (tanpa enkripsi, tanpa validasi)`);

// ========================================================
// KONSTANTA — hanya untuk LIST (bukan validasi)
// User sistem di bawah UID 1000 tidak akan muncul di panel
// ========================================================
const RESERVED_USERS = new Set([
  'root', 'daemon', 'bin', 'sys', 'sync', 'games', 'man', 'lp', 'mail',
  'news', 'uucp', 'proxy', 'www-data', 'backup', 'list', 'irc', 'gnats',
  'nobody', 'ubuntu', 'sshd', 'dropbear', 'stunnel'
]);

// ========================================================
// VALIDASI — DIHAPUS (hanya cek kosong agar code tidak crash)
// ========================================================
function validateUsername(username) {
  return typeof username === 'string' && username.length > 0;
}

function validatePassword(password) {
  return typeof password === 'string' && password.length > 0;
}

// ========================================================
// FILE I/O — atomic write + backup + recovery
// ========================================================
function loadDb() {
  for (const candidate of [DB_PATH, DB_BACKUP]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      if (!raw.trim()) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (candidate === DB_BACKUP) {
          console.warn(`[SSH-STORE] ⚠️  Loaded dari backup (main corrupt)`);
          try { fs.copyFileSync(DB_BACKUP, DB_PATH); } catch (_) {}
        }
        return parsed;
      }
    } catch (e) {
      console.error(`[SSH-STORE] ❌ Corrupt ${candidate}: ${e.message}`);
    }
  }
  return {};
}

function saveDb(data) {
  const tmp = DB_TEMP_PREFIX + process.pid + '.' + Date.now();
  try {
    if (fs.existsSync(DB_PATH)) {
      try { fs.copyFileSync(DB_PATH, DB_BACKUP); } catch (_) {}
    }
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, DB_PATH);
    try {
      fs.readdirSync(DATA_DIR)
        .filter(f => f.startsWith(path.basename(DB_PATH) + '.tmp.'))
        .forEach(f => { try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch (_) {} });
    } catch (_) {}
    return true;
  } catch (e) {
    console.error(`[SSH-STORE] ❌ Save failed: ${e.message}`);
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

// ========================================================
// LINUX USER HELPERS
// ========================================================
function getLinuxUid(username) {
  try {
    const output = execFileSync('id', ['-u', username], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const uid = Number.parseInt(output, 10);
    return Number.isInteger(uid) ? uid : null;
  } catch (_) {
    return null;
  }
}

function setLinuxPassword(username, password) {
  execFileSync('chpasswd', [], {
    input: `${username}:${password}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'pipe']
  });
}

function createLinuxUser(username) {
  execFileSync('useradd', ['-m', '-s', '/bin/bash', '--', username], {
    encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe']
  });
}

function deleteLinuxUser(username) {
  try {
    execFileSync('pkill', ['-9', '-u', username], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (_) {}
  execFileSync('userdel', ['-r', '--', username], {
    encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe']
  });
}

// ========================================================
// CRUD
// ========================================================
async function addAccount(username, password, ipAddress, userAgent) {
  // Cek kosong saja (bukan format)
  if (!validateUsername(username)) {
    return { status: 'error', message: 'Username tidak boleh kosong.' };
  }
  if (!validatePassword(password)) {
    return { status: 'error', message: 'Password tidak boleh kosong.' };
  }

  let createdLinuxUser = false;
  try {
    const db = loadDb();
    if (db[username] || getLinuxUid(username) !== null) {
      return { status: 'error', message: 'Username sudah digunakan.' };
    }

    // useradd — kalau username invalid (spasi, /, :), akan error natural
    createLinuxUser(username);
    createdLinuxUser = true;

    // chpasswd — kalau password ada ':' atau '\n', akan error natural
    setLinuxPassword(username, password);

    // Simpan plaintext
    db[username] = {
      password,
      ip_address: String(ipAddress || 'Unknown').slice(0, 255),
      user_agent: String(userAgent || 'Unknown').slice(0, 1000),
      created_at: new Date().toISOString()
    };

    if (!saveDb(db)) {
      try { deleteLinuxUser(username); } catch (_) {}
      return { status: 'error', message: 'Gagal menyimpan ke DB file. Coba lagi.' };
    }

    return { status: 'success', username, password };
  } catch (error) {
    if (createdLinuxUser) {
      try { deleteLinuxUser(username); } catch (_) {}
    }
    // Error dari useradd / chpasswd → tampilkan apa adanya
    const msg = error.stderr ? error.stderr.toString().trim() : error.message;
    console.error('[SSH-STORE] Gagal membuat akun:', msg);
    return { status: 'error', message: `Gagal: ${msg}` };
  }
}

async function listAccounts(includePasswords = false) {
  const db = loadDb();

  let passwdContent = '';
  try { passwdContent = fs.readFileSync('/etc/passwd', 'utf8'); } catch (_) {}

  const users = [];
  for (const line of passwdContent.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.split(':');
    const username = fields[0];
    const uid = Number.parseInt(fields[2], 10);
    const shell = fields[fields.length - 1];
    if (!Number.isInteger(uid) || uid < 1000 || RESERVED_USERS.has(username.toLowerCase())) continue;

    const entry = db[username];
    users.push({
      username,
      uid,
      shell,
      password: (entry && includePasswords) ? (entry.password || '-') : '-',
      ip: entry ? entry.ip_address : 'Unknown',
      user_agent: entry ? entry.user_agent : 'Unknown',
      created_at: entry ? entry.created_at : null,
      has_db_entry: !!entry
    });
  }
  users.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
  return { status: 'success', total: users.length, users };
}

async function deleteAccount(username) {
  if (!validateUsername(username)) {
    return { status: 'error', message: 'Username tidak boleh kosong.' };
  }

  try {
    const db = loadDb();
    if (!db[username]) {
      return { status: 'error', message: 'Akun tidak ditemukan di database akun SSH.' };
    }

    const uid = getLinuxUid(username);
    if (uid !== null) {
      if (uid < 1000) return { status: 'error', message: 'Akun sistem dilindungi; penghapusan dibatalkan.' };
      deleteLinuxUser(username);
    }

    delete db[username];
    if (!saveDb(db)) {
      return { status: 'error', message: 'User dihapus dari sistem, tapi DB file gagal disimpan.' };
    }
    return { status: 'success', message: `User ${username} berhasil dihapus!` };
  } catch (error) {
    console.error('[SSH-STORE] Gagal menghapus akun:', error.message);
    return { status: 'error', message: `Gagal menghapus akun SSH: ${error.message}` };
  }
}

async function restoreAccounts() {
  const db = loadDb();
  const entries = Object.entries(db);
  let restored = 0;
  let alreadyPresent = 0;
  const failures = [];

  for (const [username, entry] of entries) {
    try {
      const password = entry.password;
      if (!password || typeof password !== 'string') {
        throw new Error('password kosong di DB');
      }

      let uid = getLinuxUid(username);
      if (uid === null) {
        createLinuxUser(username);
        uid = getLinuxUid(username);
        if (uid === null) throw new Error('useradd gagal');
        restored++;
      } else {
        if (uid < 1000) throw new Error(`UID sistem (${uid}) terdeteksi`);
        alreadyPresent++;
      }
      setLinuxPassword(username, password);
    } catch (err) {
      failures.push({ username, error: err.message });
      console.error(`[SSH-STORE] ⚠️  Restore ${username} gagal: ${err.message}`);
    }
  }

  return { total: entries.length, restored, alreadyPresent, failures };
}

async function ensureSchema() { return; }
async function close() { return; }

// ========================================================
// EXPORTS
// ========================================================
module.exports = {
  addAccount, listAccounts, deleteAccount, restoreAccounts,
  ensureSchema, close, validateUsername, validatePassword,
  _paths: { DB_PATH, DB_BACKUP, DATA_DIR }
};

// ========================================================
// CLI mode: `node ssh-store.js restore`
// ========================================================
if (require.main === module) {
  const command = process.argv[2];
  if (command !== 'restore') {
    console.error('Penggunaan: node ssh-store.js restore');
    process.exit(2);
  }
  (async () => {
    try {
      const summary = await restoreAccounts();
      console.log(`[SSH-STORE] ✅ Restore selesai — total:${summary.total} created:${summary.restored} exists:${summary.alreadyPresent} failed:${summary.failures.length}`);
      if (summary.failures.length > 0) console.error('[SSH-STORE] Failures:', summary.failures);
      return;
    } catch (error) {
      console.error('[SSH-STORE] ❌ PEMULIHAN GAGAL:', error.message);
      process.exit(1);
    }
  })();
}
