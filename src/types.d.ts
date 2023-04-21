interface Server {
    id: string;
    name: string;
    host: string;
    url: string;
    cfg: string;
    ping: number;
    pingFailedTimes: number;
    conn: number;
    connFailedTimes: number;
}

interface Configuration {
    subscribe: string[];
    'servers.user': Server[];
    'servers.sub': Server[];
    server: string;
    'main.http.host': string;
    'main.http.port': number;
    'main.sock.host': string;
    'main.sock.port': number;
    'main.api.host': string;
    'main.api.port': number;
    'test.http.host': string;
    'test.http.port': number;
    'test.sock.host': string;
    'test.sock.port': number;
    'test.api.host': string;
    'test.api.port': number;
    'sub.interval': number;
    'ping.interval': number;
    'conn.interval': number;
    'v2ray.log.level': 'debug' | 'info' | 'warning' | 'error' | 'none';
    'log.level': string;
}

type VMessInbound = Partial<{
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
}>;

type VMessOutbound = {
    vnext: Partial<{
        address: string;
        port: number;
        users: Partial<{
            id: string;
            alterId: number;
            security:
                | 'aes-128-gcm'
                | 'chacha20-poly1305'
                | 'auto'
                | 'none'
                | 'zero';
            level: number;
        }>[];
    }>[];
};

type TrojanInbound = Partial<{
    clients: {
        password: string;
        email: string;
        level: number;
    }[];
    fallbacks: {
        alpn: string;
        path: string;
        dest: number;
        xver: number;
    }[];
}>;

type TrojaOutbound = {
    servers: Partial<{
        address: string;
        port: number;
        password: string;
        email: string;
        level: number;
    }>[];
};

type DokodemoDoorInbound = Partial<{
    address: string;
    port: number;
    network: 'tcp' | 'udp' | 'tcp,udp';
    timeout: number;
    followRedirect: boolean;
    userLevel: number;
}>;

type ShadowsocksInbound = Partial<{
    email: string;
    method: string;
    password: string;
    level: number;
    network: 'tcp' | 'udp' | 'tcp,udp';
    ivCheck: boolean;
}>;

type ShadowsocksOutbound = {
    servers: Partial<{
        email: string;
        address: string;
        port: number;
        method: string;
        password: string;
        level: number;
        ivCheck: boolean;
    }>[];
};

type StreamSettings = Partial<{
    network: 'tcp' | 'kcp' | 'ws' | 'http' | 'domainsocket' | 'quic' | 'grpc';
    security: 'none' | 'tls';
    tlsSettings: Partial<{
        serverName: string;
        alpn: string[];
        allowInsecure: boolean;
        disableSystemRoot: boolean;
        certificates: {
            usage: 'encipherment' | 'verify' | 'issue' | 'verifyclient';
            certificateFile: string;
            keyFile: string;
            certificate: string[];
            key: string[];
        }[];
        verifyClientCertificate: boolean;
        pinnedPeerCertificateChainSha256: string;
    }>;
    tcpSettings: {
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
    kcpSettings: {
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
    wsSettings: {
        acceptProxyProtocol: boolean;
        path: string;
        headers: Record<string, string>;
        maxEarlyData: number;
        useBrowserForwarding: boolean;
        earlyDataHeaderName: string;
    };
    httpSettings: {
        host: string[];
        path: string;
        method: string;
        headers: Record<string, string[]>;
    };
    quicSettings: {
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
    dsSettings: {
        path: string;
        abstract: boolean;
        padding: boolean;
    };
    grpcSettings: {
        serviceName: string;
    };
    sockopt: {
        mark: number;
        tcpFastOpen: boolean;
        tcpFastOpenQueueLength: number;
        tproxy: 'redirect' | 'tproxy' | 'off';
        tcpKeepAliveInterval: number;
    };
}>;

type Inbound = Partial<{
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
    settings:
        | VMessInbound
        | TrojanInbound
        | DokodemoDoorInbound
        | ShadowsocksInbound;
    streamSettings: StreamSettings;
    tag: string;
    sniffing: {
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
    allocate: {
        strategy: 'always' | 'random';
        refresh: number;
        concurrency: number;
    };
}>;

type Outbound = Partial<{
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
    settings: VMessOutbound | TrojaOutbound | ShadowsocksOutbound;
    sendThrough: string;
    tag: string;
    streamSettings: StreamSettings;
    proxySettings: {
        tag: string;
        transportLayer: boolean;
    };
    mux: {
        enabled: boolean;
        concurrency: number;
    };
}>;

interface V2rayConfig {
    name: string;
    host: string;
    log?: {
        access: string;
        error: string;
        loglevel: 'debug' | 'info' | 'warning' | 'error' | 'none';
    };
    api?: {
        tag: string;
        services: string[];
    };
    dns?: {};
    routing?: Partial<{
        domainStrategy: 'AsIs';
        domainMatcher: 'mph';
        rules: Partial<{
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
        }>[];
        balancers: {
            tag: string;
            selector: string[];
            strategy: {
                type: 'random' | 'leastPing';
            };
        }[];
    }>;
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

