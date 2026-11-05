import type {
  ProtocolType,
  ConfigType,
  ConfigFormat,
  GenerateConfigParams,
} from '@/types';

function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

export function generateConfig(params: GenerateConfigParams): string {
  const {
    protocol,
    type,
    uuid,
    host,
    bugHost,
    port,
    format,
    engine,
    paths,
    railwayDomain,
  } = params;

  const isTls = port === '443';
  const securityMode = isTls ? 'tls' : 'none';
  const fpParam = isTls ? '&fp=chrome' : '';

  const basePath = paths[protocol] || `/${protocol}-argo`;
  const netType = engine;

  let targetConnect = type === 'sni' ? bugHost : host;
  let targetSni = type === 'sni_reverse' ? bugHost : host;
  let targetWsHost = type === 'sni_reverse' ? bugHost : host;
  let finalPath = type === 'cdn' ? `/${bugHost}${basePath}` : basePath;

  let remark = `FREEDOM-${protocol.toUpperCase()}-${type.toUpperCase()}-${port}`;
  if (type === 'reality') {
    const protoLabel =
      protocol === 'vless' ? 'VLESS' : protocol === 'vmess' ? 'VMESS' : 'TROJAN';
    const realityHost = railwayDomain || host;
    remark = `REALITY-${protoLabel}-${realityHost}`;
    targetConnect = realityHost;
    targetSni = bugHost;
    targetWsHost = realityHost;
    finalPath = basePath;
  }

  if (format === 'clash_proxy') {
    return generateClashProxyOnly(
      protocol,
      targetConnect,
      port,
      uuid,
      targetSni,
      targetWsHost,
      finalPath,
      remark
    );
  }

  if (format === 'clash_mihomo') {
    return generateClashMihomo(
      protocol,
      targetConnect,
      port,
      uuid,
      targetSni,
      targetWsHost,
      finalPath,
      remark
    );
  }

  if (format === 'singbox') {
    return generateSingBoxJson(
      protocol,
      targetConnect,
      port,
      uuid,
      targetSni,
      targetWsHost,
      finalPath,
      remark
    );
  }

  // Standard link format
  if (protocol === 'vless') {
    let q = `?encryption=none&security=${securityMode}`;
    if (isTls) q += `&sni=${targetSni}${fpParam}`;
    q += `&type=${netType}`;
    if (netType === 'ws')
      q += `&host=${targetWsHost}&path=${encodeURIComponent(finalPath)}`;
    return `vless://${uuid}@${targetConnect}:${port}${q}#${encodeURIComponent(remark)}`;
  }

  if (protocol === 'vmess') {
    const jsonVmess = {
      v: '2',
      ps: remark,
      add: targetConnect,
      port,
      id: uuid,
      aid: '0',
      scy: 'auto',
      net: netType,
      type: 'none',
      host: targetWsHost,
      path: finalPath,
      tls: isTls ? 'tls' : '',
      sni: isTls ? targetSni : '',
      fp: isTls ? 'chrome' : '',
    };
    return `vmess://${toBase64(JSON.stringify(jsonVmess))}`;
  }

  // trojan
  let q = `?security=${securityMode}`;
  if (isTls) q += `&sni=${targetSni}${fpParam}`;
  q += `&type=${netType}`;
  if (netType === 'ws')
    q += `&host=${targetWsHost}&path=${encodeURIComponent(finalPath)}`;
  return `trojan://${uuid}@${targetConnect}:${port}${q}#${encodeURIComponent(remark)}`;
}

function generateClashProxyOnly(
  protocol: ProtocolType,
  targetConnect: string,
  selectedPort: string,
  uuid: string,
  targetSni: string,
  targetWsHost: string,
  finalPath: string,
  remark: string
): string {
  const isTls = selectedPort === '443';
  if (protocol === 'vless') {
    return `proxies:
  - name: "${remark}"
    type: vless
    server: ${targetConnect}
    port: ${parseInt(selectedPort)}
    uuid: ${uuid}
    udp: true
    tls: ${isTls}
    servername: ${targetSni}
    skip-cert-verify: true
    network: ws
    ws-opts:
      path: "${finalPath}"
      headers:
        Host: ${targetWsHost}`.trim();
  }
  if (protocol === 'vmess') {
    return `proxies:
  - name: "${remark}"
    type: vmess
    server: ${targetConnect}
    port: ${parseInt(selectedPort)}
    uuid: ${uuid}
    alterId: 0
    cipher: auto
    udp: true
    tls: ${isTls}
    servername: ${targetSni}
    skip-cert-verify: true
    network: ws
    ws-opts:
      path: "${finalPath}"
      headers:
        Host: ${targetWsHost}`.trim();
  }
  return `proxies:
  - name: "${remark}"
    type: trojan
    server: ${targetConnect}
    port: ${parseInt(selectedPort)}
    password: ${uuid}
    udp: true
    sni: ${targetSni}
    skip-cert-verify: true
    network: ws
    ws-opts:
      path: "${finalPath}"
      headers:
        Host: ${targetWsHost}`.trim();
}

function generateClashMihomo(
  protocol: ProtocolType,
  targetConnect: string,
  selectedPort: string,
  uuid: string,
  targetSni: string,
  targetWsHost: string,
  finalPath: string,
  remark: string
): string {
  const proxyYaml = generateClashProxyOnly(
    protocol,
    targetConnect,
    selectedPort,
    uuid,
    targetSni,
    targetWsHost,
    finalPath,
    remark
  );
  return `mixed-port: 7890
allow-lan: true
mode: rule
log-level: info
ipv6: false

dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver:
    - 8.8.8.8
    - 1.1.1.1

${proxyYaml}

proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - "${remark}"
      - DIRECT

rules:
  - GEOIP,LAN,DIRECT
  - MATCH,PROXY`.trim();
}

function generateSingBoxJson(
  protocol: ProtocolType,
  targetConnect: string,
  selectedPort: string,
  uuid: string,
  targetSni: string,
  targetWsHost: string,
  finalPath: string,
  remark: string
): string {
  const isTls = selectedPort === '443';
  const outboundObj: Record<string, any> = {
    type: protocol,
    tag: remark,
    server: targetConnect,
    server_port: parseInt(selectedPort),
    transport: {
      type: 'ws',
      path: finalPath,
      headers: { Host: targetWsHost },
    },
  };

  if (protocol === 'vless' || protocol === 'vmess') {
    outboundObj.uuid = uuid;
  } else {
    outboundObj.password = uuid;
  }

  if (isTls) {
    outboundObj.tls = {
      enabled: true,
      server_name: targetSni,
      insecure: true,
    };
  }

  const fullConfig = {
    log: { level: 'info' },
    inbounds: [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: 2080,
      },
    ],
    outbounds: [outboundObj, { type: 'direct', tag: 'direct' }],
    route: { auto_detect_interface: true },
  };

  return JSON.stringify(fullConfig, null, 2);
}
