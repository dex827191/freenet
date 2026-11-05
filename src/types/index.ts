export interface ZtDomain {
  domain: string;
  port: string;
}

export interface WsProxyConfig {
  sshPort: number;
  keepAlive: number;
  maxBuffer: number;
}

export interface SystemSettings {
  banner: string;
  enable_bbr: string;
  udpgw_port: string;
  udpgw_max_clients?: string;
}

export interface ServerStats {
  active_cfip: string;
  quick_url: string;
  zt_domains: ZtDomain[];
  zt_vmess_domains: ZtDomain[];
  pass_configured: boolean;
  railway_public: string;
  railway_sni: string;
  status: string;
  dns_type: string;
  custom_dns: string;
  engine_mode: string;
  ws_proxy_cfg: WsProxyConfig;
  sys_settings: SystemSettings;
  cpu_model: string;
  ram_total: string;
  ram_used: string;
  disk_usage: string;
  uptime: string;
  ssh_online: string;
  user_list_details: string;
}

export interface SshUser {
  username: string;
  uid: number;
  shell: string;
  password?: string;
  ip?: string;
  user_agent?: string;
}

export interface ServerInfo {
  uuid: string;
  cfip: string;
  domain: string;
  paths: {
    vless: string;
    vmess: string;
    trojan: string;
  };
}

export type ProtocolType = 'vless' | 'vmess' | 'trojan';
export type ConfigType = 'sni' | 'sni_reverse' | 'cdn' | 'reality';
export type ConfigFormat = 'standard' | 'clash_proxy' | 'clash_mihomo' | 'singbox';

export interface GenerateConfigParams {
  protocol: ProtocolType;
  type: ConfigType;
  uuid: string;
  host: string;
  bugHost: string;
  port: string;
  format: ConfigFormat;
  engine: string;
  paths: { vless: string; vmess: string; trojan: string };
  railwayDomain?: string;
}
