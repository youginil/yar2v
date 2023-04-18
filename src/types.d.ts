interface Server {
    id: string;
    name: string;
    host: string;
    url: string;
    cfg: string;
    delay?: number;
}

interface Configuration {
    subscribe: string[];
    'servers.user': Server[];
    'servers.sub': Server[];
    server: string;
    'local.http.host': string;
    'local.http.port': number;
    'local.sock.host': string;
    'local.sock.port': number;
    'log.level': string;
}

interface VMessOutbound {
    vnext: {
        address: string;
        port: number;
        users: {
            id: string;
            alterId: number;
            security:
                | 'aes-128-gcm'
                | 'chacha20-poly1305'
                | 'auto'
                | 'none'
                | 'zero';
            level?: number;
        }[];
    }[];
}

interface VMessInbound {
    clients: {
        id: string;
        level: number;
        alterId: number;
        email: string;
    }[];
    default: {
        level: number;
        alterId: number;
    };
    detour: {
        to: string;
    };
    disableInsecureEncryption: false;
}

interface StreamSettings {
    network: 'tcp' | 'kcp' | 'ws' | 'http' | 'domainsocket' | 'quic' | 'grpc';
    security: 'none' | 'tls';
    tlsSettings?: {
        serverName: string;
        alpn: string[];
        allowInsecure: boolean;
        disableSystemRoot?: boolean;
        certificates?: {
            usage: 'encipherment' | 'verify' | 'issue' | 'verifyclient';
            certificateFile: string;
            keyFile: string;
            certificate: string[];
            key: string[];
        }[];
        verifyClientCertificate?: boolean;
        pinnedPeerCertificateChainSha256?: string;
    };
    tcpSettings?: {
        acceptProxyProtocol: boolean;
        header:
            | { type: 'none' }
            | {
                  type: 'http';
                  request: {
                      version: string;
                      method: string;
                      path: string[];
                      headers: Record<string, string | string[]>;
                  };
                  response: {
                      version: string;
                      status: string;
                      reason: string;
                      headers: Record<string, string | string[]>;
                  };
              };
    };
    kcpSettings?: {
        mtu: number;
        tti: number;
        uplinkCapacity: number;
        downlinkCapacity: number;
        congestion: boolean;
        readBufferSize: number;
        writeBufferSize: number;
        header: {
            type:
                | 'none'
                | 'srtp'
                | 'utp'
                | 'wechat-video'
                | 'dtls'
                | 'wireguard';
        };
        seed: string;
    };
    wsSettings?: {
        acceptProxyProtocol: boolean;
        path: string;
        headers: Record<string, string>;
        maxEarlyData: number;
        useBrowserForwarding: boolean;
        earlyDataHeaderName: string;
    };
    httpSettings?: {
        host: string[];
        path: string;
        method: string;
        headers: Record<string, string[]>;
    };
    quicSettings?: {
        security: 'none' | 'aes-128-gcm' | 'chacha20-poly1305';
        key: string;
        header: {
            type:
                | 'none'
                | 'srtp'
                | 'utp'
                | 'wechat-video'
                | 'dtls'
                | 'wireguard';
        };
    };
    dsSettings?: {
        path: string;
        abstract: boolean;
        padding: boolean;
    };
    grpcSettings?: {
        serviceName: string;
    };
    sockopt?: {
        mark: number;
        tcpFastOpen: boolean;
        tcpFastOpenQueueLength: number;
        tproxy: 'redirect' | 'tproxy' | 'off';
        tcpKeepAliveInterval: number;
    };
}

interface Inbound {
    listen: string;
    port: number | string;
    protocol:
        | 'dokodemo-door'
        | 'http'
        | 'socks'
        | 'vmess'
        | 'shadowsocks'
        | 'trojan'
        | 'vless';
    settings?: VMessInbound;
    streamSettings?: StreamSettings;
    tag?: string;
    sniffing?: {
        enabled: boolean;
        destOverride: (
            | 'http'
            | 'tls'
            | 'quic'
            | 'fakedns'
            | 'fakedns+others'
        )[];
        metadataOnly: boolean;
    };
    allocate?: {
        strategy: 'always' | 'random';
        refresh: number;
        concurrency: number;
    };
}

interface Outbound {
    protocol:
        | 'blackhole'
        | 'dns'
        | 'freedom'
        | 'http'
        | 'socks'
        | 'vmess'
        | 'shadowsocks'
        | 'trojan'
        | 'vless'
        | 'loopback';
    settings: VMessOutbound;
    sendThrough?: string;
    tag?: string;
    streamSettings?: StreamSettings;
    proxySettings?: {
        tag: string;
        transportLayer: boolean;
    };
    mux?: {
        enabled: boolean;
        concurrency: number;
    };
}

interface V2rayConfig {
    name: string; // custom
    log: {
        access: string;
        error: string;
        loglevel: 'debug' | 'info' | 'warning' | 'error' | 'none';
    };
    api?: {
        tag: string;
        services: string[];
    };
    dns?: {};
    routing?: {
        domainStrategy: 'AsIs';
        domainMatcher: 'mph';
        rules: {
            domainMatcher: 'linear' | 'mph';
            type: 'field';
            domains: string[];
            ip: string[];
            port: number | string;
            sourcePort: number | string;
            network: 'tcp' | 'udp' | 'tcp,udp';
            source: string[];
            user: string[];
            inboundTag: string[];
            protocol: ('http' | 'tls' | 'bittorrent')[];
            attrs: string;
            outboundTag: string;
            balancerTag: string;
        }[];
        balancers: {
            tag: string;
            selector: string[];
            strategy: {
                type: 'random' | 'leastPing';
            };
        }[];
    };
    policy?: {
        levels: Record<
            string,
            {
                handshake: number;
                connIdle: number;
                uplinkOnly: number;
                downlinkOnly: number;
                statsUserUplink: boolean;
                statsUserDownlink: boolean;
                bufferSize: number;
            }
        >;
        system: {
            statsInboundUplink: boolean;
            statsInboundDownlink: boolean;
            statsOutboundUplink: boolean;
            statsOutboundDownlink: boolean;
        };
    };
    inbounds: Inbound[];
    outbounds: Outbound[];
    transport?: Pick<
        StreamSettings,
        | 'tcpSettings'
        | 'kcpSettings'
        | 'wsSettings'
        | 'httpSettings'
        | 'quicSettings'
        | 'dsSettings'
        | 'grpcSettings'
    >;
    stats?: {};
    reverse?: {
        bridges: {
            tag: string;
            domain: string;
        }[];
        portals: {
            tag: string;
            domain: string;
        }[];
    };
    fakedns?: {
        ipPool: string;
        poolSize: number;
    }[];
    browserForwarder?: {
        listenAddr: string;
        listenPort: number;
    };
    observatory?: {
        subjectSelector: string[];
        probeURL: string;
        probeInterval: string;
    };
}

