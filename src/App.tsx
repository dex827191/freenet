import { useState, useEffect, useCallback, useRef } from 'react';
import { TopBar } from '@/components/TopBar';
import { Sidebar, type PageId } from '@/components/Sidebar';
import { Dashboard } from '@/pages/Dashboard';
import { CreateSsh } from '@/pages/CreateSsh';
import { SshSettings } from '@/pages/SshSettings';
import { V2raySettings } from '@/pages/V2raySettings';
import { CfipSettings } from '@/pages/CfipSettings';
import { ConfigGenerator } from '@/pages/ConfigGenerator';
import { PromptDialog, ToastContainer, useToast } from '@/components/Toast';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { fetchStats, loginAdmin, setupPass, setArgoToken } from '@/lib/api';
import type { ServerStats } from '@/types';

function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginPass, setLoginPass] = useState('');
  const [changePassOpen, setChangePassOpen] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [argoDialogOpen, setArgoDialogOpen] = useState(false);
  const [argoToken, setArgoToken] = useState('');

  const { toasts, showToast } = useToast();
  const { adminToken, isAdmin, isPassConfigured, setIsPassConfigured, setToken, logout } =
    useAdminAuth();

  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchStats();
      setStats(data);
      setIsPassConfigured(data.pass_configured);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [setIsPassConfigured]);

  useEffect(() => {
    loadStats();
    statsTimerRef.current = setInterval(loadStats, 300000);
    return () => {
      if (statsTimerRef.current) clearInterval(statsTimerRef.current);
    };
  }, [loadStats]);

  const handleNavigate = (page: PageId) => {
    setCurrentPage(page);
    setSidebarOpen(false);
  };

  const handleAdminAction = () => {
    if (!isPassConfigured) {
      setLoginDialogOpen(true);
      setLoginPass('');
      return;
    }
    if (isAdmin) {
      logout();
      showToast('Berhasil logout dari admin', 'info');
      return;
    }
    setLoginDialogOpen(true);
    setLoginPass('');
  };

  const handleLoginConfirm = async (value: string) => {
    if (!isPassConfigured) {
      // Setup new password
      if (!value || value.length < 4) {
        showToast('Password minimal 4 karakter!', 'error');
        return;
      }
      try {
        const data = await setupPass(value);
        if (data.status === 'success') {
          setToken(value);
          setIsPassConfigured(true);
          showToast('Password admin berhasil dibuat', 'success');
          setLoginDialogOpen(false);
          loadStats();
        } else {
          showToast(data.message, 'error');
        }
      } catch {
        showToast('Gagal membuat password', 'error');
      }
      return;
    }

    // Login
    try {
      const data = await loginAdmin(value);
      if (data.status === 'success') {
        setToken(data.token || value);
        showToast('Login admin berhasil', 'success');
        setLoginDialogOpen(false);
        loadStats();
      } else {
        showToast(data.message || 'Password salah', 'error');
      }
    } catch {
      showToast('Gagal terhubung ke server', 'error');
    }
  };

  const handleChangePass = () => {
    setChangePassOpen(true);
    setNewPass('');
  };

  const handleChangePassConfirm = async (value: string) => {
    if (!adminToken) return;
    if (!value || value.length < 4) {
      showToast('Password minimal 4 karakter!', 'error');
      return;
    }
    try {
      const data = await setupPass(value, adminToken);
      showToast(data.message, data.status === 'success' ? 'success' : 'error');
      if (data.status === 'success') {
        setToken(value);
        setChangePassOpen(false);
      }
    } catch {
      showToast('Gagal mengupdate password', 'error');
    }
  };

  const handleArgoToken = () => {
    setArgoDialogOpen(true);
    setArgoToken('');
  };

  const handleArgoConfirm = async (value: string) => {
    setArgoDialogOpen(false);
    if (!adminToken) {
      showToast('Login admin dulu untuk set token Argo', 'error');
      return;
    }
    try {
      const data = await setArgoToken(adminToken, value);
      showToast(data.message, data.status === 'success' ? 'success' : 'error');
      if (data.status === 'success') loadStats();
    } catch {
      showToast('Gagal memperbarui token', 'error');
    }
  };

  const requireAdmin = async (): Promise<boolean> => {
    if (adminToken) return true;
    showToast('Akses Ditolak! Login Admin terlebih dahulu.', 'error');
    setLoginDialogOpen(true);
    setLoginPass('');
    return false;
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard stats={stats} onSetArgoToken={handleArgoToken} />;
      case 'create-ssh':
        return (
          <CreateSsh
            isAdmin={isAdmin}
            adminToken={adminToken}
            showToast={showToast}
          />
        );
      case 'set-ssh':
        return (
          <SshSettings
            stats={stats}
            adminToken={adminToken}
            onRequireAdmin={requireAdmin}
            showToast={showToast}
          />
        );
      case 'set-v2ray':
        return (
          <V2raySettings
            stats={stats}
            adminToken={adminToken}
            onRequireAdmin={requireAdmin}
            showToast={showToast}
          />
        );
      case 'set-cfip':
        return (
          <CfipSettings
            stats={stats}
            adminToken={adminToken}
            onRequireAdmin={requireAdmin}
            showToast={showToast}
          />
        );
      case 'generator':
        return <ConfigGenerator stats={stats} showToast={showToast} />;
      default:
        return <Dashboard stats={stats} onSetArgoToken={handleArgoToken} />;
    }
  };

  return (
    <div className="min-h-screen bg-surface-container-low">
      <div className="flex">
        <Sidebar
          currentPage={currentPage}
          onNavigate={handleNavigate}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          isAdmin={isAdmin}
          isPassConfigured={isPassConfigured}
          onChangePass={handleChangePass}
        />

        <div className="flex-1 min-w-0">
          <TopBar
            onToggleSidebar={() => setSidebarOpen(true)}
            isAdmin={isAdmin}
            isPassConfigured={isPassConfigured}
            onAdminAction={handleAdminAction}
            onChangePass={handleChangePass}
            showChangePass={isAdmin && isPassConfigured}
          />

          <main className="px-4 py-6 lg:px-8 lg:py-8">
            <div className="mx-auto max-w-3xl">
              {loading && !stats ? (
                <div className="flex items-center justify-center py-20">
                  <div className="h-8 w-8 rounded-full border-2 border-primary-40 border-t-transparent animate-spin" />
                </div>
              ) : (
                renderPage()
              )}
            </div>
          </main>
        </div>
      </div>

      {/* Dialogs */}
      <PromptDialog
        open={loginDialogOpen}
        title={
          !isPassConfigured
            ? 'KREASI PASSWORD ADMIN PERTAMA KALI'
            : 'MASUKKAN PASSWORD ADMIN'
        }
        label="Password Admin"
        placeholder="Masukkan password..."
        defaultValue={loginPass}
        onConfirm={handleLoginConfirm}
        onCancel={() => setLoginDialogOpen(false)}
      />

      <PromptDialog
        open={changePassOpen}
        title="GANTI PASSWORD ADMIN"
        label="Password Admin Baru"
        placeholder="Masukkan password baru..."
        onConfirm={handleChangePassConfirm}
        onCancel={() => setChangePassOpen(false)}
      />

      <PromptDialog
        open={argoDialogOpen}
        title="MASUKKAN TOKEN CLOUDFLARE ARGO"
        label="Argo Token (Kosongkan lalu klik OK untuk menghapus token tersimpan)"
        placeholder="Cloudflare Argo Tunnel token..."
        onConfirm={handleArgoConfirm}
        onCancel={() => setArgoDialogOpen(false)}
      />

      <ToastContainer toasts={toasts} />
    </div>
  );
}

export default App;
