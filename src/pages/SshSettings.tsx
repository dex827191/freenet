import { useState, useEffect } from 'react';
import { Settings, Save, AlertCircle } from 'lucide-react';
import type { ServerStats } from '@/types';
import { saveWsProxySetting, saveSystemSetting } from '@/lib/api';
import { Card, SectionTitle, Field, Select, Input } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

interface SshSettingsProps {
  stats: ServerStats | null;
  adminToken: string;
  onRequireAdmin: () => Promise<boolean>;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const portOptions = [
  { value: '22', label: 'Port 22 (OpenSSH)' },
  { value: '109', label: 'Port 109 (Dropbear Direct)' },
  { value: '143', label: 'Port 143 (Dropbear Alt)' },
  { value: '447', label: 'Port 447 (SSL Stunnel)' },
  { value: 'custom', label: 'Custom...' },
];

const keepOptions = [
  { value: '5000', label: '5000 (5s)' },
  { value: '15000', label: '15000 (15s)' },
  { value: '30000', label: '30000 (30s)' },
  { value: 'custom', label: 'Custom...' },
];

const bufOptions = [
  { value: '16384', label: '16384 (16KB)' },
  { value: '32768', label: '32768 (32KB)' },
  { value: '65536', label: '65536 (64KB)' },
  { value: 'custom', label: 'Custom...' },
];

const bbrOptions = [
  { value: 'true', label: 'ON' },
  { value: 'false', label: 'OFF' },
];

const udpgwOptions = [
  { value: '7300', label: 'Port 7300' },
  { value: '7200', label: 'Port 7200' },
  { value: '7100', label: 'Port 7100' },
];

export function SshSettings({ stats, adminToken, onRequireAdmin, showToast }: SshSettingsProps) {
  const [portSel, setPortSel] = useState('22');
  const [portCustom, setPortCustom] = useState('');
  const [keepSel, setKeepSel] = useState('15000');
  const [keepCustom, setKeepCustom] = useState('');
  const [bufSel, setBufSel] = useState('32768');
  const [bufCustom, setBufCustom] = useState('');
  const [banner, setBanner] = useState('');
  const [bbr, setBbr] = useState('true');
  const [udpgw, setUdpgw] = useState('7300');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (stats?.ws_proxy_cfg) {
      const p = String(stats.ws_proxy_cfg.sshPort);
      if (portOptions.some((o) => o.value === p)) setPortSel(p);
      else {
        setPortSel('custom');
        setPortCustom(p);
      }
      const k = String(stats.ws_proxy_cfg.keepAlive);
      if (keepOptions.some((o) => o.value === k)) setKeepSel(k);
      else {
        setKeepSel('custom');
        setKeepCustom(k);
      }
      const b = String(stats.ws_proxy_cfg.maxBuffer);
      if (bufOptions.some((o) => o.value === b)) setBufSel(b);
      else {
        setBufSel('custom');
        setBufCustom(b);
      }
    }
    if (stats?.sys_settings) {
      setBanner(stats.sys_settings.banner || '');
      setBbr(stats.sys_settings.enable_bbr || 'true');
      setUdpgw(stats.sys_settings.udpgw_port || '7300');
    }
  }, [stats]);

  const handleSave = async () => {
    let token = adminToken;
    if (!token) {
      const ok = await onRequireAdmin();
      if (!ok) return;
      return;
    }

    setSaving(true);
    const port = portSel === 'custom' ? portCustom : portSel;
    const keep = keepSel === 'custom' ? keepCustom : keepSel;
    const buf = bufSel === 'custom' ? bufCustom : bufSel;

    try {
      const r1 = await saveWsProxySetting(token, port || '22', keep || '15000', buf || '32768');
      const r2 = await saveSystemSetting(token, banner, bbr, udpgw);
      showToast(`${r1.message} | ${r2.message}`, r1.status === 'success' ? 'success' : 'error');
    } catch {
      showToast('Gagal memperbarui SSH Config', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="animate-slide-up space-y-5">
      <PageHeader
        title="Pengaturan SSH"
        subtitle="Konfigurasi Dropbear, BBR, dan UDPGW"
        icon={<Settings size={20} />}
      />

      <Card>
        <SectionTitle>SSH Server Configuration</SectionTitle>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Field label="Port Dropbear">
            <Select value={portSel} onChange={setPortSel} options={portOptions} />
            {portSel === 'custom' && (
              <Input
                value={portCustom}
                onChange={setPortCustom}
                placeholder="Port..."
                type="number"
                className="mt-2"
              />
            )}
          </Field>
          <Field label="KeepAlive">
            <Select value={keepSel} onChange={setKeepSel} options={keepOptions} />
            {keepSel === 'custom' && (
              <Input
                value={keepCustom}
                onChange={setKeepCustom}
                placeholder="MS..."
                type="number"
                className="mt-2"
              />
            )}
          </Field>
          <Field label="Max Buffer">
            <Select value={bufSel} onChange={setBufSel} options={bufOptions} />
            {bufSel === 'custom' && (
              <Input
                value={bufCustom}
                onChange={setBufCustom}
                placeholder="Bytes..."
                type="number"
                className="mt-2"
              />
            )}
          </Field>
        </div>

        <div className="border-t border-neutral-90/40 pt-4">
          <Field label="Banner Dropbear">
            <textarea
              value={banner}
              onChange={(e) => setBanner(e.target.value)}
              placeholder="Kosongkan untuk banner standar..."
              className="m3-field min-h-[60px] resize-y font-mono text-xs"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4 mt-3">
            <Field label="TCP BBR">
              <Select value={bbr} onChange={setBbr} options={bbrOptions} />
            </Field>
            <Field label="UDPGW Port">
              <Select value={udpgw} onChange={setUdpgw} options={udpgwOptions} />
            </Field>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="m3-btn m3-btn-filled state-layer w-full mt-5"
        >
          <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan SSH Config'}
        </button>
      </Card>

      <div className="flex items-start gap-2 text-xs text-neutral-60 bg-primary-95/50 rounded-m3-sm p-3">
        <AlertCircle size={14} className="text-primary-50 mt-0.5 shrink-0" />
        Perubahan pada port dan BBR akan langsung di-apply ke server. UDPGW akan di-restart otomatis.
      </div>
    </div>
  );
}
