import { useState, useEffect } from 'react';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Clock,
  Users,
  Wifi,
  Globe,
  Zap,
  Server,
  ArrowUpRight,
  Activity,
  Download,
  Upload,
  TrendingUp,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { ServerStats } from '@/types';
import { Card, SectionTitle } from '@/components/ui';
import { CopyButton } from '@/components/CopyButton';
import { cn } from '@/lib/utils';

interface DashboardProps {
  stats: ServerStats | null;
  onSetArgoToken: () => void;
}

export function Dashboard({ stats, onSetArgoToken }: DashboardProps) {
  // ===== TOGGLE VISIBILITY =====
  const [showTraffic, setShowTraffic] = useState(true);
  const [showPulse, setShowPulse] = useState(true);

  // ===== TRAFFIC SPEEDS (simulasi realtime) =====
  const [dlSpeed, setDlSpeed] = useState(181.0);
  const [ulSpeed, setUlSpeed] = useState(226.22);

  // ===== PULSE BARS (35 bar) =====
  const [bars, setBars] = useState<number[]>(() =>
    Array.from({ length: 35 }, () => Math.random() * 80 + 10)
  );

  useEffect(() => {
    const iv = setInterval(() => {
      setDlSpeed(Math.random() * 100 + 100);
      setUlSpeed(Math.random() * 150 + 100);
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setBars((prev) =>
        prev.map(() =>
          Math.random() > 0.85 ? Math.random() * 90 + 10 : Math.random() * 20 + 5
        )
      );
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const statCards = [
    {
      icon: Cpu,
      label: 'CPU Model',
      value: stats?.cpu_model || 'Loading...',
      span: true,
    },
    {
      icon: MemoryStick,
      label: 'RAM Used / Total',
      value: stats ? `${stats.ram_used} / ${stats.ram_total}` : 'Loading...',
    },
    {
      icon: HardDrive,
      label: 'Disk Usage',
      value: stats?.disk_usage || 'Loading...',
    },
    {
      icon: Clock,
      label: 'Server Uptime',
      value: stats?.uptime || 'Loading...',
    },
    {
      icon: Users,
      label: 'SSH Online',
      value: stats ? `${stats.ssh_online} Active` : '0 Active',
      detail: stats?.user_list_details,
    },
  ];

  const settingsInfo = [
    { label: 'CFIP', value: stats?.active_cfip || 'Default' },
    { label: 'DNS', value: stats ? `${stats.dns_type} (${stats.custom_dns})` : 'UDP' },
    { label: 'Engine', value: stats?.engine_mode?.toUpperCase() || 'WS' },
    { label: 'Port', value: stats?.ws_proxy_cfg?.sshPort?.toString() || '22' },
    {
      label: 'KeepAlive',
      value: stats ? `${stats.ws_proxy_cfg?.keepAlive || 15000}ms` : '15000ms',
    },
    {
      label: 'BBR',
      value: stats?.sys_settings?.enable_bbr === 'true' ? 'ON' : 'OFF',
    },
    {
      label: 'UDPGW',
      value: stats?.sys_settings?.udpgw_port || '7300',
    },
  ];

  const urlSections = [
    {
      title: 'REALITY Server (VLESS/VMess/Trojan)',
      value: stats?.railway_public || 'Tidak Aktif',
      id: 'railway-url',
    },
    {
      title: 'SSH SNI Server',
      value: stats?.railway_sni || 'Tidak Aktif',
      id: 'sni-url',
    },
    {
      title: 'SSH WS Domain',
      value:
        stats?.zt_domains && stats.zt_domains.length > 0
          ? stats.zt_domains.map((d) => d.domain).join(', ')
          : 'Menghubungkan...',
      id: 'ssh-ws-url',
    },
    {
      title: 'VMess / VLess Domain',
      value:
        stats?.zt_vmess_domains && stats.zt_vmess_domains.length > 0
          ? stats.zt_vmess_domains.map((d) => d.domain).join(', ')
          : 'Menghubungkan...',
      id: 'vmess-url',
    },
    {
      title: 'Quick Tunnel Sub',
      value: stats?.quick_url || 'Loading...',
      id: 'quick-url',
    },
  ];

  return (
    <div className="animate-slide-up space-y-5">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-10">Dashboard Server</h1>
        <div className="mt-2 inline-flex items-center gap-2 m3-chip bg-success-90 text-success-20 border border-success-60/30">
          <span className="h-2 w-2 rounded-full bg-success-50 animate-pulse-dot" />
          All Tunnels Online
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={i}
              className={cn(
                'm3-card p-4 border-l-4 border-l-primary-50',
                card.span && 'col-span-2'
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={16} className="text-primary-50" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-60">
                  {card.label}
                </span>
              </div>
              <div className="text-sm font-bold text-neutral-10 break-all">
                {card.value}
              </div>
              {card.detail && (
                <div className="mt-1 text-[10px] text-neutral-60 whitespace-pre-line">
                  {card.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ============================================ */}
      {/* TRAFFIC METRICS                             */}
      {/* ============================================ */}
      <div className="m3-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-primary-50" />
            <h2 className="text-sm font-bold text-neutral-10">Traffic Metrics</h2>
          </div>
          <button
            onClick={() => setShowTraffic((v) => !v)}
            className="m3-chip bg-surface-container-high text-neutral-10 hover:bg-surface-container-highest transition-colors"
            aria-label={showTraffic ? 'Hide traffic' : 'Show traffic'}
          >
            {showTraffic ? <EyeOff size={12} /> : <Eye size={12} />}
            <span className="ml-1">{showTraffic ? 'Hide' : 'Show'}</span>
          </button>
        </div>

        {showTraffic && (
          <div className="grid grid-cols-2 gap-3 animate-slide-up">
            <div className="bg-surface-container-high rounded-m3-sm p-3 border-l-2 border-l-success-50">
              <div className="flex items-center gap-1.5 mb-1">
                <Download size={12} className="text-success-50" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-60">
                  Download
                </span>
              </div>
              <p className="text-lg font-bold text-neutral-10">128.4 MB</p>
              <p className="text-[11px] text-success-50 font-bold mt-0.5">
                {dlSpeed.toFixed(1)} KB/s
              </p>
            </div>

            <div className="bg-surface-container-high rounded-m3-sm p-3 border-l-2 border-l-primary-50">
              <div className="flex items-center gap-1.5 mb-1">
                <Upload size={12} className="text-primary-50" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-60">
                  Upload
                </span>
              </div>
              <p className="text-lg font-bold text-neutral-10">96.2 MB</p>
              <p className="text-[11px] text-primary-50 font-bold mt-0.5">
                {ulSpeed.toFixed(2)} KB/s
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ============================================ */}
      {/* ANIMATED PULSE GRAPH                        */}
      {/* ============================================ */}
      <div className="m3-card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-primary-50" />
            <h2 className="text-sm font-bold text-neutral-10">
              Network Traffic <span className="text-neutral-60 font-normal">(60s)</span>
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-2 text-[10px] font-bold">
              <span className="text-success-50">● RX</span>
              <span className="text-primary-50">● TX</span>
            </div>
            <button
              onClick={() => setShowPulse((v) => !v)}
              className="m3-chip bg-surface-container-high text-neutral-10 hover:bg-surface-container-highest transition-colors"
              aria-label={showPulse ? 'Hide pulse graph' : 'Show pulse graph'}
            >
              {showPulse ? <EyeOff size={12} /> : <Eye size={12} />}
              <span className="ml-1">{showPulse ? 'Hide' : 'Show'}</span>
            </button>
          </div>
        </div>

        {showPulse && (
          <div className="w-full bg-surface-container-high rounded-m3-sm h-16 flex items-end p-1 gap-0.5 overflow-hidden animate-slide-up border border-outline-variant/30">
            {bars.map((h, i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-t transition-all duration-300',
                  h > 60
                    ? 'bg-primary-50 shadow-[0_0_6px_rgba(59,130,246,0.6)]'
                    : 'bg-primary-50/30'
                )}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Argo Token Button */}
      <button
        onClick={onSetArgoToken}
        className="m3-btn m3-btn-outlined state-layer w-full py-3"
      >
        <Zap size={16} /> Masukkan Token Argo Tunnel
      </button>

      {/* Server Settings Info */}
      <Card>
        <SectionTitle>Info Pengaturan Server</SectionTitle>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          {settingsInfo.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="font-medium text-neutral-60">{item.label}:</span>
              <span className="font-mono font-semibold text-neutral-10 text-right">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Tunnel URLs */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Server size={18} className="text-primary-50" />
          <h2 className="text-sm font-bold text-neutral-10">Tunnel URLs</h2>
        </div>
        {urlSections.map((section) => {
          const isDisabled =
            section.value.includes('Menunggu') ||
            section.value.includes('Tidak Aktif') ||
            section.value.includes('Menghubungkan');
          return (
            <div key={section.id} className="m3-card p-3">
              <div className="flex items-center gap-2 mb-2">
                <Globe size={14} className="text-neutral-50" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-50">
                  {section.title}
                </span>
              </div>
              <div className="flex items-center gap-2 bg-surface-container-high rounded-m3-sm px-3 py-2">
                <span className="flex-1 font-mono text-xs font-semibold text-neutral-10 truncate">
                  {section.value}
                </span>
                <CopyButton
                  text={section.value}
                  disabled={isDisabled}
                  variant="text"
                  label="Copy"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2 text-[10px] text-neutral-60 pt-2">
        <Wifi size={12} /> Dynamic Triple-Tunnel Node Core Active
        <ArrowUpRight size={12} />
      </div>
    </div>
  );
}
