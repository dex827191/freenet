'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');

// ========================================================
// DB CONNECTION
// ========================================================
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL tidak ditemukan. Hubungkan layanan PostgreSQL ke aplikasi.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// ========================================================
// KONSTANTA
// ========================================================
const RESERVED_USERS = new Set([
  'root', 'daemon', 'bin', 'sys', 'sync', 'games', 'man', 'lp', 'mail',
  'news', 'uucp', 'proxy', 'www-data', 'backup', 'list', 'irc', 'gnats',
  'nobody', 'ubuntu', 'sshd', 'dropbear', 'stunnel'
]);

let schemaPromise;

// ========================================================
// ENCRYPTION (AES-256-GCM)
// ========================================================
function getEncryptionKey() {
  const raw = (process.env.SSH_CREDENTIALS_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error('SSH_CREDENTIALS_KEY belum diatur. Gunakan kunci hex 64 karakter (32 byte).');
  }
  return Buffer.from(raw, 'hex');
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

function decryptPassword(row) {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.password_iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.password_tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.password_ciphertext, 'base64')),
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
  // Regex sengaja ketat — mencegah chpasswd injection (tidak boleh ':')
  return typeof password === 'string' &&
    password.length >= 4 && password.length <= 128 &&
    /^[a-zA-Z0-9_@.-]+$/.test(password);
}

// ========================================================
// SCHEMA
// ========================================================
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS ssh_accounts (
        username VARCHAR(32) PRIMARY KEY,
        password_ciphertext TEXT NOT NULL,
        password_iv VARCHAR(24) NOT NULL,
        password_tag VARCHAR(32) NOT NULL,
        ip_address TEXT NOT NULL DEFAULT 'Unknown',
        user_agent TEXT NOT NULL DEFAULT 'Unknown',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
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
  // Kill proses user dulu
  try {
    execFileSync('pkill', ['-9', '-u', username], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (_) {}
  // Hapus user
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
    getEncryptionKey();
    await ensureSchema();

    const existing = await pool.query(
      'SELECT 1 FROM ssh_accounts WHERE username = $1', [username]
    );
    if (existing.rowCount > 0 || getLinuxUid(username) !== null) {
      return { status: 'error', message: 'Username sudah digunakan.' };
    }

    createLinuxUser(username);
    createdLinuxUser = true;
    setLinuxPassword(username, password);

    const encrypted = encryptPassword(password);
    await pool.query(
      `INSERT INTO ssh_accounts
       (username, password_ciphertext, password_iv, password_tag, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        username,
        encrypted.password_ciphertext,
        encrypted.password_iv,
        encrypted.password_tag,
        String(ipAddress || 'Unknown').slice(0, 255),
        String(userAgent || 'Unknown').slice(0, 1000)
      ]
    );

    return { status: 'success', username, password };
  } catch (error) {
    if (createdLinuxUser) {
      try { deleteLinuxUser(username); } catch (_) {}
    }
    if (error && error.code === '23505') {
      return { status: 'error', message: 'Username sudah terdaftar.' };
    }
    console.error('[SSH-STORE] Gagal membuat akun:', error.message);
    return { status: 'error', message: 'Gagal membuat atau menyimpan akun SSH. Periksa log aplikasi.' };
  }
}

async function listAccounts(includePasswords = false) {
  await ensureSchema();
  const result = await pool.query(
    'SELECT username, password_ciphertext, password_iv, password_tag, ip_address, user_agent, created_at FROM ssh_accounts ORDER BY created_at DESC'
  );
  const stored = new Map(result.rows.map(row => [row.username, row]));
  const persistentUser = process.env.PERSISTENT_SSH_USER || '';

  // Fallback metadata lama (transisi dari /tmp/ssh_details.json)
  const tempMetadataPath = '/tmp/ssh_details.json';
  let tempMetadata = {};
  try {
    if (fs.existsSync(tempMetadataPath)) {
      const parsed = JSON.parse(fs.readFileSync(tempMetadataPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) tempMetadata = parsed;
    }
  } catch (_) {}

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

    const row = stored.get(username);
    const fallback = username === persistentUser ? (tempMetadata[username] || {}) : {};
    let password = '-';
    if (row && includePasswords) {
      try { password = decryptPassword(row); }
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
      ip: row ? row.ip_address : (fallback.ip || 'Unknown'),
      user_agent: row ? row.user_agent : (fallback.user_agent || 'Unknown'),
      created_at: row ? row.created_at : null,
      has_db_entry: !!row
    });
  }
  return { status: 'success', total: users.length, users };
}

async function deleteAccount(username) {
  if (!validateUsername(username)) {
    return { status: 'error', message: 'Username tidak valid atau dilindungi.' };
  }

  try {
    await ensureSchema();
    const found = await pool.query('SELECT username FROM ssh_accounts WHERE username = $1', [username]);
    if (found.rowCount === 0) {
      return { status: 'error', message: 'Akun tidak ditemukan di database akun SSH.' };
    }

    const uid = getLinuxUid(username);
    if (uid !== null) {
      if (uid < 1000) return { status: 'error', message: 'Akun sistem dilindungi; penghapusan dibatalkan.' };
      deleteLinuxUser(username);
    }

    await pool.query('DELETE FROM ssh_accounts WHERE username = $1', [username]);
    return { status: 'success', message: `User ${username} berhasil dihapus!` };
  } catch (error) {
    console.error('[SSH-STORE] Gagal menghapus akun:', error.message);
    return { status: 'error', message: 'Gagal menghapus akun SSH. Periksa log aplikasi.' };
  }
}

async function restoreAccounts() {
  getEncryptionKey();
  await ensureSchema();
  const result = await pool.query(
    'SELECT username, password_ciphertext, password_iv, password_tag FROM ssh_accounts ORDER BY created_at ASC'
  );
  let restored = 0;
  let alreadyPresent = 0;
  const failures = [];
  const persistentUser = process.env.PERSISTENT_SSH_USER || '';

  for (const row of result.rows) {
    const username = row.username;
    // Per-user try/catch agar 1 user rusak tidak stop semua
    try {
      if (!validateUsername(username) || username === persistentUser) {
        throw new Error('data tidak valid atau bertabrakan dengan akun utama');
      }
      const password = decryptPassword(row);
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

  return { total: result.rowCount, restored, alreadyPresent, failures };
}

async function close() {
  await pool.end();
}

// ========================================================
// EXPORTS
// ========================================================
module.exports = {
  addAccount, listAccounts, deleteAccount, restoreAccounts,
  ensureSchema, close, validateUsername, validatePassword
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
    let lastError;
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        const summary = await restoreAccounts();
        console.log(`[SSH-STORE] ✅ Restore selesai — total:${summary.total} created:${summary.restored} exists:${summary.alreadyPresent} failed:${summary.failures.length}`);
        if (summary.failures.length > 0) console.error('[SSH-STORE] Failures:', summary.failures);
        await close();
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 8) {
          console.error(`[SSH-STORE] DB belum siap (${attempt}/8): ${error.message}`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }
    console.error('[SSH-STORE] ❌ PEMULIHAN GAGAL:', lastError ? lastError.message : 'Unknown');
    try { await close(); } catch (_) {}
    process.exit(1);
  })();
}
