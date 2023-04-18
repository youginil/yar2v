type Parser = (url: string) => { name: string; host: string; ob: Outbound };

const parseVmess: Parser = (url: string) => {
    const json = Buffer.from(url.slice(8), 'base64').toString();
    const data = JSON.parse(json);
    let name = '';
    if (data.ps) {
        name = data.ps;
    } else {
        name = data.add;
    }
    const ob: Outbound = {
        protocol: 'vmess',
        settings: {
            vnext: [
                {
                    address: data.add,
                    port: +data.port,
                    users: [
                        {
                            id: data.id,
                            alterId: +data.aid,
                            security: data.scy ? data.scy : 'auto',
                        },
                    ],
                },
            ],
        },
        streamSettings: {
            network: data.net,
            security: data.tls === 'tls' ? 'tls' : 'none',
            tlsSettings:
                data.tls === 'tls'
                    ? {
                          serverName: data.sni ? data.sni : data.host,
                          alpn: data.alpn ? data.alpn.split(',') : [],
                          allowInsecure: data.allowInsecure ?? true,
                      }
                    : undefined,
        },
    };
    return { name, host: data.add, ob };
};

const parseTrojan: Parser = (url: string) => {
    const uo = new URL(url);
    const name = uo.hash ? decodeURIComponent(uo.hash.slice(1)) : uo.hostname;
    const ob: Outbound = {
        protocol: 'trojan',
        settings: {
            servers: [
                { address: uo.hostname, port: +uo.port, password: uo.username },
            ],
        },
    };
    return { name, host: uo.hostname, ob };
};

const parsers: {
    prefix: string;
    parser: (url: string) => { name: string; host: string; ob: Outbound };
}[] = [
    { prefix: 'vmess://', parser: parseVmess },
    { prefix: 'trojan://', parser: parseTrojan },
];

export function parseURL(url: string): V2rayConfig | undefined {
    const cfg: V2rayConfig = {
        name: '',
        host: '',
        log: {
            access: '',
            error: '',
            loglevel: 'none',
        },
        inbounds: [],
        outbounds: [],
    };
    for (let i = 0; i < parsers.length; i++) {
        const { prefix, parser } = parsers[i];
        if (url.startsWith(prefix)) {
            const { name, host, ob } = parser(url);
            cfg.name = name;
            cfg.host = host;
            cfg.outbounds.push(ob);
            return cfg;
        }
    }
}

export function setInbounds(
    cfg: V2rayConfig,
    httpHost: string,
    httpPort: number,
    sockHost: string,
    sockPort: number
) {
    cfg.inbounds = [
        {
            protocol: 'http',
            listen: httpHost,
            port: httpPort,
        },
        {
            protocol: 'socks',
            listen: sockHost,
            port: sockPort,
        },
    ];
}

