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
