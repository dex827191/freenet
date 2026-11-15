'use strict';

const crypto = require('crypto');
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

// ========================================================
// KONSTANTA
// ========================================================
const RESERVED_USERS = new Set([
  'root', 'daemon', 'bin', 'sys', 'sync', 'games', 'man', 'lp', 'mail',
  'news', 'uucp', 'proxy', 'www-data', 'backup', 'list', 'irc', 'gnats',
  'nobody', 'ubuntu', 'sshd', 'dropbear', 'stunnel'
]);

// ========================================================
// ENCRYPTION (AES-256-GCM)
// ========================================================
let _keyCache = null;
function getEncryptionKey() {
  if (_keyCache) return _keyCache;
  const raw = (process.env.SSH_CREDENTIALS_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error('SSH_CREDENTIALS_KEY belum diatur. Gunakan 64 hex chars (openssl rand -hex 32).');
  }
  _keyCache = Buffer.from(raw, 'hex');
  return _keyCache;
}

function encryptPassword(password) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return {
    password_ciphertext: ciphertext.toString('base64'),
    password_iv: iv.toString('hex'),
    password_tag: cipher.getAuthTag().toString('hex')
  };
}

function decryptPassword(entry) {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(entry.password_iv, 'hex'));
  decipher.setAuthTag(Buffer.from(entry.password_tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(entry.password_ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

// ========================================================
// VALIDASI
// ========================================================
function validateUsername(username) {
  return typeof username === 'string' &&
    username.length >= 2 && username.length <= 32 &&
    /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(username) &&
    !RESERVED_USERS.has(username.toLowerCase()) &&
    username !== (process.env.PERSISTENT_SSH_USER || '');
}

function validatePassword(password) {
  return typeof password === 'string' &&
    password.length >= 4 && password.length <= 128 &&
    /^[a-zA-Z0-9_@.-]+$/.test(password);
}

// ========================================================
// FILE I/O — atomic write + backup + recovery
// ========================================================
function loadDb() {
  // Try main DB
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
    // Backup existing DB dulu
    if (fs.existsSync(DB_PATH)) {
      try { fs.copyFileSync(DB_PATH, DB_BACKUP); } catch (_) {}
    }
    // Atomic write
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, DB_PATH);
    // Cleanup orphan .tmp files (kalau ada dari crash sebelumnya)
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
  if (!validateUsername(username)) {
    return { status: 'error', message: 'Username tidak valid. 2–32 karakter, harus diawali huruf, hanya huruf/angka/underscore/dash, tidak boleh reserved.' };
  }
  if (!validatePassword(password)) {
    return { status: 'error', message: 'Password tidak valid. 4–128 karakter; hanya huruf, angka, _, @, titik, atau -.' };
  }

  let createdLinuxUser = false;
  try {
    getEncryptionKey(); // validate key exists

    const db = loadDb();
    if (db[username] || getLinuxUid(username) !== null) {
      return { status: 'error', message: 'Username sudah digunakan.' };
    }

    createLinuxUser(username);
    createdLinuxUser = true;
    setLinuxPassword(username, password);

    const encrypted = encryptPassword(password);
    db[username] = {
      password_ciphertext: encrypted.password_ciphertext,
      password_iv: encrypted.password_iv,
      password_tag: encrypted.password_tag,
      ip_address: String(ipAddress || 'Unknown').slice(0, 255),
      user_agent: String(userAgent || 'Unknown').slice(0, 1000),
      created_at: new Date().toISOString()
    };

    if (!saveDb(db)) {
      // Rollback
      try { deleteLinuxUser(username); } catch (_) {}
      return { status: 'error', message: 'Gagal menyimpan ke DB file. Coba lagi.' };
    }

    return { status: 'success', username, password };
  } catch (error) {
    if (createdLinuxUser) {
      try { deleteLinuxUser(username); } catch (_) {}
    }
    console.error('[SSH-STORE] Gagal membuat akun:', error.message);
    return { status: 'error', message: `Gagal membuat akun: ${error.message}` };
  }
}

async function listAccounts(includePasswords = false) {
  const db = loadDb();
  const persistentUser = process.env.PERSISTENT_SSH_USER || '';

  // Safe read /etc/passwd
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
    let password = '-';
    if (entry && includePasswords) {
      try { password = decryptPassword(entry); }
      catch (error) {
        console.error(`[SSH-STORE] Tidak dapat membuka password akun ${username}:`, error.message);
        password = '[tidak dapat dibuka: periksa SSH_CREDENTIALS_KEY]';
      }
    }

    users.push({
      username,
      uid,
      shell,
      password,
      ip: entry ? entry.ip_address : 'Unknown',
      user_agent: entry ? entry.user_agent : 'Unknown',
      created_at: entry ? entry.created_at : null,
      has_db_entry: !!entry
    });
  }
  // Sort by created_at DESC
  users.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
  return { status: 'success', total: users.length, users };
}

async function deleteAccount(username) {
  if (!validateUsername(username)) {
    return { status: 'error', message: 'Username tidak valid atau dilindungi.' };
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
  getEncryptionKey();
  const db = loadDb();
  const entries = Object.entries(db);
  let restored = 0;
  let alreadyPresent = 0;
  const failures = [];
  const persistentUser = process.env.PERSISTENT_SSH_USER || '';

  for (const [username, entry] of entries) {
    try {
      if (!validateUsername(username) || username === persistentUser) {
        throw new Error('data tidak valid atau bertabrakan dengan akun utama');
      }
      const password = decryptPassword(entry);
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

async function ensureSchema() {
  // No-op untuk file-based (auto-create saat saveDb)
  return;
}

async function close() {
  // No-op untuk file-based
  return;
}

// ========================================================
// EXPORTS
// ========================================================
module.exports = {
  addAccount, listAccounts, deleteAccount, restoreAccounts,
  ensureSchema, close, validateUsername, validatePassword,
  // Expose untuk debugging
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
