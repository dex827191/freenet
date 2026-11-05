import { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  KeyRound,
  Globe,
  Bug,
  Port,
  FileCode,
  Server,
  Check,
  Copy,
} from 'lucide-react';
import type { ServerStats, ServerInfo, ProtocolType, ConfigType, ConfigFormat } from '@/types';
import { fetchServerInfo } from '@/lib/api';
import { generateConfig } from '@/lib/configGenerator';
import { Card, SectionTitle, Field, Select, Input } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { CopyButton } from '@/components/CopyButton';
import { cn } from '@/lib/utils';

interface ConfigGeneratorProps {
  stats: ServerStats | null;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const formatOptions = [
  { value: 'standard', label: 'Standard Link (v2rayNG / DarkTunnel)' },
  { value: 'clash_proxy', label: 'Clash - Proxy Only (YAML)' },
  { value: 'clash_mihomo', label: 'Clash - Mihomo (Full YAML)' },
  { value: 'singbox', label: 'SingBox (Full JSON)' },
];

const portOptions = [
  { value: '443', label: 'Port 443 (TLS + Auto FP)' },
  { value: '80', label: 'Port 80 (NTLS / Direct)' },
];

export function ConfigGenerator({ stats, showToast }: ConfigGeneratorProps) {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [uuid, setUuid] = useState('Loading...');
  const [domain, setDomain] = useState('');
  const [bugHost, setBugHost] = useState('v.whatsapp.net');
  const [port, setPort] = useState('443');
  const [format, setFormat] = useState<ConfigFormat>('standard');
  const [engine, setEngine] = useState('ws');
  const [output, setOutput] = useState('');
  const [outputLabel, setOutputLabel] = useState('');
  const [activeBtn, setActiveBtn] = useState<string>('');

  const loadServerInfo = useCallback(async () => {
    try {
      const info = await fetchServerInfo();
      setServerInfo(info);
      if (info.uuid) setUuid(info.uuid);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadServerInfo();
  }, [loadServerInfo]);

  useEffect(() => {
    if (stats) {
      setEngine(stats.engine_mode || 'ws');
    }
  }, [stats]);

  // Build domain options from stats
  const domainOptions = (() => {
    const opts: { value: string; label: string }[] = [];
    const currentHost = window.location.hostname;
    if (currentHost) {
      opts.push({ value: currentHost, label: `Domain Utama: ${currentHost}` });
    }
    if (stats?.railway_public && stats.railway_public !== 'Tidak Aktif') {
      opts.push({ value: stats.railway_public, label: `Railway Reality: ${stats.railway_public}` });
    }
    if (stats?.quick_url && !stats.quick_url.includes('Menunggu')) {
      opts.push({ value: stats.quick_url, label: `Quick Tunnel: ${stats.quick_url}` });
    }
    if (stats?.zt_vmess_domains) {
      stats.zt_vmess_domains.forEach((d) => {
        opts.push({ value: d.domain, label: `Zero Argo: ${d.domain}` });
      });
    }
    if (opts.length === 0) {
      opts.push({ value: '', label: '-- Menunggu Domain --' });
    }
    return opts;
  })();

  useEffect(() => {
    if (domainOptions.length > 0 && !domain) {
      setDomain(domainOptions[0].value);
    }
  }, [domainOptions]);

  const paths = serverInfo?.paths || {
    vless: '/vless-argo',
    vmess: '/vmess-argo',
    trojan: '/trojan-argo',
  };

  const handleGenerate = (
    protocol: ProtocolType,
    type: ConfigType | 'reality'
  ) => {
    const cleanHost = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!cleanHost || cleanHost.includes('Menunggu')) {
      showToast('Domain Tunnel belum siap / belum dipilih!', 'error');
      return;
    }

    const railwayDomain = stats?.railway_public && stats.railway_public !== 'Tidak Aktif'
      ? stats.railway_public
      : '';

    const result = generateConfig({
      protocol,
      type: type as ConfigType,
      uuid,
      host: cleanHost,
      bugHost,
      port,
      format,
      engine,
      paths,
      railwayDomain,
    });

    const protoLabel =
      protocol === 'vless' ? 'VLESS' : protocol === 'vmess' ? 'VMESS' : 'TROJAN';
    const typeLabel = type === 'reality' ? 'REALITY' : type.toUpperCase();
    const formatLabel =
      format === 'clash_proxy'
        ? ' (CLASH PROXY)'
        : format === 'clash_mihomo'
          ? ' (CLASH MIHOMO)'
          : format === 'singbox'
            ? ' (SINGBOX JSON)'
            : '';

    setOutputLabel(`${typeLabel} ${protoLabel}${formatLabel}`);
    setOutput(result);
    setActiveBtn(`${protocol}-${type}`);
  };

  const realityButtons: { protocol: ProtocolType; label: string }[] = [
    { protocol: 'vless', label: 'VLESS' },
    { protocol: 'vmess', label: 'VMESS' },
    { protocol: 'trojan', label: 'TROJAN' },
  ];

  const configGroups: { title: string; type: ConfigType; }[] = [
    { title: 'Bug SNI (Normal)', type: 'sni' },
    { title: 'Bug SNI (Reverse)', type: 'sni_reverse' },
    { title: 'Bug CDN (Proxy)', type: 'cdn' },
  ];

  const protocols: { protocol: ProtocolType; label: string; suffix?: string }[] = [
    { protocol: 'vless', label: 'VLESS' },
    { protocol: 'vmess', label: 'VMESS' },
    { protocol: 'trojan', label: 'TROJAN' },
  ];

  return (
    <div className="animate-slide-up space-y-5">
      <PageHeader
        title="Config Generator"
        subtitle="Generate VLESS, VMess, Trojan configs"
        icon={<Zap size={20} />}
      />

      <Card className="overflow-hidden">
        <SectionTitle>Configuration Parameters</SectionTitle>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 min-w-0">
          <Field label="UUID / Pass" className="min-w-0 overflow-hidden">
            <Input value={uuid} onChange={setUuid} readOnly className="font-mono truncate" />
          </Field>
          <Field label="Target Domain" className="min-w-0 overflow-hidden">
            <Select value={domain} onChange={setDomain} options={domainOptions} className="font-mono font-bold truncate" />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 min-w-0">
          <Field label="Bug Host (SNI / CDN)" className="min-w-0 overflow-hidden">
            <Input value={bugHost} onChange={setBugHost} className="font-mono truncate" />
          </Field>
          <Field label="Port Target" className="min-w-0 overflow-hidden">
            <Select value={port} onChange={setPort} options={portOptions} className="font-mono font-bold" />
          </Field>
        </div>

        <Field label="Format Output Config" className="min-w-0 overflow-hidden">
          <Select value={format} onChange={setFormat} options={formatOptions} className="font-mono font-bold" />
        </Field>
      </Card>

      {/* Reality / Railway */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Server size={16} className="text-success-50" />
          <span className="text-xs font-bold text-success-50 uppercase tracking-wide">
            Reality / Railway
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 min-w-0">
          {realityButtons.map(({ protocol, label }) => (
            <GenButton
              key={`reality-${protocol}`}
              active={activeBtn === `${protocol}-reality`}
              onClick={() => handleGenerate(protocol, 'reality')}
              variant="success"
            >
              {label} REALITY
            </GenButton>
          ))}
        </div>
      </Card>

      {/* Config type groups */}
      {configGroups.map((group) => (
        <Card key={group.type}>
          <div className="border-l-4 border-l-primary-50 pl-3 mb-3">
            <span className="text-xs font-bold text-neutral-10 uppercase">
              {group.title}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 min-w-0">
            {protocols.map(({ protocol, label }) => (
              <GenButton
                key={`${group.type}-${protocol}`}
                active={activeBtn === `${protocol}-${group.type}`}
                onClick={() => handleGenerate(protocol, group.type)}
              >
                {label}
                {group.type === 'sni_reverse' ? ' REV' : ''}
              </GenButton>
            ))}
          </div>
        </Card>
      ))}

      {/* Output */}
      {output && (
        <Card className="animate-scale-in">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-primary-50">{outputLabel}</span>
            <CopyButton text={output} label="Copy" />
          </div>
          <pre className="text-xs font-mono text-neutral-10 bg-surface-container-high rounded-m3-sm p-3 max-h-[160px] overflow-auto whitespace-pre-wrap break-all">
            {output}
          </pre>
        </Card>
      )}
    </div>
  );
}

function GenButton({
  children,
  active,
  onClick,
  variant = 'default',
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  variant?: 'default' | 'success';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'state-layer rounded-m3-sm py-2.5 px-2 text-[10px] font-bold font-mono transition-all duration-200 active:scale-95',
        !active && variant === 'default' && 'bg-surface-container-high text-neutral-30 border border-neutral-80/50 hover:bg-surface-container-highest',
        !active && variant === 'success' && 'bg-success-95 text-success-30 border border-success-60/30 hover:bg-success-90',
        active && variant === 'default' && 'bg-primary-90 text-primary-20 border border-primary-60',
        active && variant === 'success' && 'bg-success-80 text-success-10 border border-success-60',
      )}
    >
      {children}
    </button>
  );
}
