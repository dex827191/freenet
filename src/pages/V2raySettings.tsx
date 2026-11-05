import { useState, useEffect } from 'react';
import { Network, Save } from 'lucide-react';
import type { ServerStats } from '@/types';
import { saveNetworkSetting } from '@/lib/api';
import { Card, SectionTitle, Field, Select, Input } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

interface V2raySettingsProps {
  stats: ServerStats | null;
  adminToken: string;
  onRequireAdmin: () => Promise<boolean>;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const dnsTypeOptions = [
  { value: 'udp', label: 'UDP Fast DNS' },
  { value: 'doh', label: 'DoH Secure DNS' },
];

const engineOptions = [
  { value: 'ws', label: 'WebSocket (WS)' },
  { value: 'grpc', label: 'gRPC Engine' },
  { value: 'h2', label: 'HTTP/2 (H2)' },
  { value: 'tcp', label: 'TCP Direct' },
];

const dnsOptions = [
  { value: '8.8.8.8', label: 'Google DNS (8.8.8.8)' },
  { value: '1.1.1.1', label: 'Cloudflare DNS (1.1.1.1)' },
  { value: '9.9.9.9', label: 'Quad9 DNS (9.9.9.9)' },
  { value: 'https://1.1.1.1/dns-query', label: 'Cloudflare DoH' },
  { value: 'https://dns.google/dns-query', label: 'Google DoH' },
  { value: 'custom', label: 'Custom...' },
];

export function V2raySettings({ stats, adminToken, onRequireAdmin, showToast }: V2raySettingsProps) {
  const [dnsType, setDnsType] = useState('udp');
  const [engine, setEngine] = useState('ws');
  const [dnsSel, setDnsSel] = useState('8.8.8.8');
  const [dnsCustom, setDnsCustom] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (stats) {
      if (stats.dns_type) setDnsType(stats.dns_type);
      if (stats.engine_mode) setEngine(stats.engine_mode);
      if (stats.custom_dns) {
        if (dnsOptions.some((o) => o.value === stats.custom_dns)) {
          setDnsSel(stats.custom_dns);
        } else {
          setDnsSel('custom');
          setDnsCustom(stats.custom_dns);
        }
      }
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
    const customDns = dnsSel === 'custom' ? dnsCustom : dnsSel;
    try {
      const data = await saveNetworkSetting(
        token,
        dnsType,
        customDns || '8.8.8.8',
        engine
      );
      showToast(
        data.message,
        data.status === 'success' ? 'success' : 'error'
      );
    } catch {
      showToast('Gagal menyimpan konfigurasi ke backend', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="animate-slide-up space-y-5">
      <PageHeader
        title="Pengaturan V2Ray"
        subtitle="DNS mode, engine, dan custom DNS"
        icon={<Network size={20} />}
      />

      <Card>
        <SectionTitle>V2Ray Server Configuration</SectionTitle>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field label="DNS Mode">
            <Select value={dnsType} onChange={setDnsType} options={dnsTypeOptions} />
          </Field>
          <Field label="Engine Mode">
            <Select value={engine} onChange={setEngine} options={engineOptions} />
          </Field>
        </div>

        <Field label="Custom DNS IP / DoH URL">
          <Select value={dnsSel} onChange={setDnsSel} options={dnsOptions} />
          {dnsSel === 'custom' && (
            <Input
              value={dnsCustom}
              onChange={setDnsCustom}
              placeholder="Ketik DNS Manual..."
              className="mt-2"
            />
          )}
        </Field>

        <button
          onClick={handleSave}
          disabled={saving}
          className="m3-btn m3-btn-filled state-layer w-full mt-5"
        >
          <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan V2Ray Config'}
        </button>
      </Card>
    </div>
  );
}
