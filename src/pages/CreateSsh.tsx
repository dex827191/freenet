import { useState, useEffect, useCallback } from 'react';
import {
  UserPlus,
  Trash2,
  Info,
  ShieldAlert,
  CheckCircle2,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import type { SshUser } from '@/types';
import {
  fetchAccounts,
  createSshAccount,
  deleteSshAccount,
} from '@/lib/api';
import { Card, SectionTitle, Input } from '@/components/ui';
import { CopyButton } from '@/components/CopyButton';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/Toast';
import { cn } from '@/lib/utils';

interface CreateSshProps {
  isAdmin: boolean;
  adminToken: string;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function CreateSsh({ isAdmin, adminToken, showToast }: CreateSshProps) {
  const [users, setUsers] = useState<SshUser[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // ===== INFO PANEL STATE =====
  const [selectedUser, setSelectedUser] = useState<SshUser | null>(null);
  const [showInfo, setShowInfo] = useState(true);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await fetchAccounts();
      if (data.status === 'success') {
        setUsers(data.users);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleCreate = async () => {
    if (!username || !password) {
      setErrorMsg('Isi username & password!');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setResultMsg('');
    try {
      const data = await createSshAccount(username, password);
      if (data.status === 'success') {
        setResultMsg(data.message);
        setUsername('');
        setPassword('');
        loadAccounts();
        showToast('Akun SSH berhasil dibuat', 'success');
      } else {
        setErrorMsg(data.message);
        showToast(data.message, 'error');
      }
    } catch {
      setErrorMsg('Gagal memproses API');
      showToast('Gagal memproses API', 'error');
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget || !adminToken) return;
    try {
      const data = await deleteSshAccount(deleteTarget, adminToken);
      if (data.status === 'success') {
        loadAccounts();
        showToast(`User ${deleteTarget} berhasil dihapus`, 'success');
        if (selectedUser?.username === deleteTarget) {
          setSelectedUser(null);
        }
      } else {
        showToast(data.message, 'error');
      }
    } catch {
      showToast('Gagal menghapus user', 'error');
    }
    setDeleteTarget(null);
  };

  const showDetails = (user: SshUser) => {
    setSelectedUser(user);
    setShowInfo(true);
  };

  return (
    <div className="animate-slide-up space-y-5">
      <PageHeader
        title="Buat Akun SSH"
        subtitle="Kelola akun SSH kustom server"
        icon={<UserPlus size={20} />}
      />

      {/* Create Form */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <SectionTitle className="mb-0 pb-0 border-0">Buat Akun Baru</SectionTitle>
          <span
            className={cn(
              'm3-chip',
              isAdmin
                ? 'bg-primary-90 text-primary-20'
                : 'bg-neutral-90 text-neutral-30'
            )}
          >
            {isAdmin ? 'Admin Route' : 'Public Creation'}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <Input
            value={username}
            onChange={setUsername}
            placeholder="Username..."
            className="flex-1"
          />
          <Input
            value={password}
            onChange={setPassword}
            placeholder="Password..."
            type="password"
            className="flex-1"
          />
          <button
            onClick={handleCreate}
            disabled={loading}
            className="m3-btn m3-btn-filled state-layer whitespace-nowrap"
          >
            <UserPlus size={16} /> {loading ? 'Adding...' : 'ADD'}
          </button>
        </div>

        {errorMsg && (
          <p className="text-xs font-bold text-error-50 mb-2">{errorMsg}</p>
        )}

        {resultMsg && (
          <div className="mt-3">
            <div className="m3-card bg-success-95 border-success-60/30 p-3 mb-2">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={14} className="text-success-50" />
                <span className="text-xs font-bold text-success-20">Akun Dibuat</span>
              </div>
              <pre className="text-xs font-mono text-neutral-10 whitespace-pre-wrap break-all">
                {resultMsg}
              </pre>
            </div>
            <CopyButton
              text={resultMsg}
              label="Copy Detail Akun"
              className="w-full"
            />
          </div>
        )}
      </Card>

      {/* ============================================ */}
      {/* INFO PANEL (muncul di luar tabel, bisa toggle) */}
      {/* ============================================ */}
      {selectedUser && (
        <div className="m3-card p-4 border-l-4 border-l-primary-50 animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Info size={16} className="text-primary-50" />
              <h2 className="text-sm font-bold text-neutral-10">
                Detail Akun <span className="text-primary-50">{selectedUser.username}</span>
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowInfo((v) => !v)}
                className="m3-chip bg-surface-container-high text-neutral-10 hover:bg-surface-container-highest transition-colors"
                aria-label={showInfo ? 'Hide detail' : 'Show detail'}
              >
                {showInfo ? <EyeOff size={12} /> : <Eye size={12} />}
                <span className="ml-1">{showInfo ? 'Hide' : 'Show'}</span>
              </button>
              <button
                onClick={() => setSelectedUser(null)}
                className="m3-chip bg-error-90 text-error-20 hover:bg-error-80 transition-colors"
                aria-label="Close"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {showInfo && (
            <div className="space-y-2 animate-slide-up">
              {[
                { label: 'Username', value: selectedUser.username },
                { label: 'Password', value: selectedUser.password || '-' },
                { label: 'IP Address', value: selectedUser.ip || 'Unknown' },
                { label: 'Shell', value: selectedUser.shell || '-' },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center gap-2 bg-surface-container-high rounded-m3-sm px-3 py-2"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-60 w-20 shrink-0">
                    {row.label}
                  </span>
                  <span className="flex-1 font-mono text-xs font-semibold text-neutral-10 break-all">
                    {row.value}
                  </span>
                  <CopyButton
                    text={row.value}
                    variant="text"
                    label="Copy"
                  />
                </div>
              ))}

              <CopyButton
                text={`Username: ${selectedUser.username}\nPassword: ${selectedUser.password || '-'}\nIP: ${selectedUser.ip || 'Unknown'}\nShell: ${selectedUser.shell || '-'}`}
                label="Copy Semua Detail"
                className="w-full mt-2"
              />
            </div>
          )}
        </div>
      )}

      {/* Account List */}
      <Card>
        <SectionTitle>Daftar Akun Terdaftar</SectionTitle>
        {users.length === 0 ? (
          <p className="text-center text-sm text-neutral-60 py-6">
            Belum ada akun SSH kustom
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-90/60">
                  <th className="text-left py-2 px-3 text-xs font-bold text-neutral-60 uppercase">
                    Username
                  </th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-neutral-60 uppercase hidden sm:table-cell">
                    Shell
                  </th>
                  <th className="text-right py-2 px-3 text-xs font-bold text-neutral-60 uppercase">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.username}
                    className={cn(
                      'border-b border-neutral-95/50 hover:bg-surface-container-low/60 transition-colors',
                      selectedUser?.username === user.username &&
                        'bg-primary-95/60 border-l-2 border-l-primary-50'
                    )}
                  >
                    <td className="py-2.5 px-3 font-semibold text-neutral-10">
                      {user.username}
                    </td>
                    <td className="py-2.5 px-3 text-neutral-60 hidden sm:table-cell font-mono text-xs">
                      {user.shell}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => showDetails(user)}
                          className={cn(
                            'm3-chip state-layer',
                            selectedUser?.username === user.username
                              ? 'bg-primary-80 text-white'
                              : 'bg-success-90 text-success-20 hover:bg-success-80'
                          )}
                        >
                          <Info size={12} /> Info
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => setDeleteTarget(user.username)}
                            className="m3-chip bg-error-90 text-error-20 hover:bg-error-80 state-layer"
                          >
                            <Trash2 size={12} /> Hapus
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isAdmin && (
          <div className="mt-4 flex items-center gap-2 text-xs text-neutral-60 bg-neutral-95/60 rounded-m3-sm p-3">
            <ShieldAlert size={14} className="text-warning-60" />
            Login admin untuk menghapus akun
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus Akun SSH"
        message={`Yakin ingin menghapus akun "${deleteTarget}"?`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
