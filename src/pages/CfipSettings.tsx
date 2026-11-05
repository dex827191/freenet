import { Globe, Edit3, Info } from 'lucide-react';
import type { ServerStats } from '@/types';
import { setCfip } from '@/lib/api';
import { Card, SectionTitle } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { useState } from 'react';
import { PromptDialog } from '@/components/Toast';

interface CfipSettingsProps {
  stats: ServerStats | null;
  adminToken: string;
  onRequireAdmin: () => Promise<boolean>;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function CfipSettings({ stats, adminToken, onRequireAdmin, showToast }: CfipSettingsProps) {
  const [promptOpen, setPromptOpen] = useState(false);

  const handleOpen = async () => {
    if (!adminToken) {
      const ok = await onRequireAdmin();
      if (!ok) return;
    }
    setPromptOpen(true);
  };

  const handleConfirm = async (value: string) => {
    setPromptOpen(false);
    if (!adminToken) return;

    try {
      const data = await setCfip(adminToken, value);
      showToast(
        data.message,
        data.status === 'success' ? 'success' : 'error'
      );
    } catch {
      showToast('Gagal memperbarui CFIP', 'error');
    }
  };

  return (
    <div className="animate-slide-up space-y-5">
      <PageHeader
        title="Pengaturan CFIP"
        subtitle="Cloudflare Clean IP configuration"
        icon={<Globe size={20} />}
      />

      <Card>
        <SectionTitle>Cloudflare Clean IP (CFIP)</SectionTitle>

        <div className="m3-card bg-surface-container-high p-4 mb-4">
          <div className="text-xs font-medium text-neutral-60 mb-1">Active CFIP</div>
          <div className="text-lg font-mono font-bold text-neutral-10">
            {stats?.active_cfip || 'Default'}
          </div>
        </div>

        <p className="text-sm text-neutral-60 mb-4 leading-relaxed">
          Atur IP Cloudflare yang bersih untuk kestabilan koneksi. Kosongkan dan klik OK untuk
          reset ke default.
        </p>

        <button
          onClick={handleOpen}
          className="m3-btn m3-btn-filled state-layer w-full"
        >
          <Edit3 size={16} /> Ubah / Reset CFIP
        </button>
      </Card>

      <div className="flex items-start gap-2 text-xs text-neutral-60 bg-primary-95/50 rounded-m3-sm p-3">
        <Info size={14} className="text-primary-50 mt-0.5 shrink-0" />
        Contoh CFIP: 104.17.3.81. Gunakan IP Cloudflare yang bersih untuk koneksi optimal.
      </div>

      <PromptDialog
        open={promptOpen}
        title="Masukkan IP Clean Cloudflare (CFIP)"
        label="CFIP Address"
        placeholder="Contoh: 104.17.3.81 (Kosongkan untuk reset ke default)"
        defaultValue={stats?.active_cfip || ''}
        onConfirm={handleConfirm}
        onCancel={() => setPromptOpen(false)}
      />
    </div>
  );
}
