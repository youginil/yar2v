import logger from './logger';

function parseVmess(url: string): { name: string; ob: Outbound } {
    logger.info(`Parse vmess: ${url}`);
    const json = Buffer.from(url.slice(8), 'base64').toString();
    const data = JSON.parse(json);
    logger.debug(data);
    let name = 'Untitle';
    if (data.ps) {
        name = data.ps;
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
    return { name, ob };
}

export function parseURL(url: string): V2rayConfig | undefined {
    const cfg: V2rayConfig = {
        name: '',
        log: {
            access: '',
            error: '',
            loglevel: 'none',
        },
        inbounds: [],
        outbounds: [],
    };
    if (url.startsWith('vmess://')) {
        const { name, ob } = parseVmess(url);
        cfg.name = name;
        cfg.outbounds.push(ob);
    } else if (url.startsWith('trojan://')) {
        logger.info('Ignore trojan://');
        return;
    } else if (url.startsWith('vless://')) {
        logger.info('Ingore vless://');
        return;
    } else if (url.startsWith('ss://')) {
        logger.info('Ignore ss://');
        return;
    } else if (url.startsWith('ssr://')) {
        return;
    }
    if (!cfg.name) {
        cfg.name = cfg.outbounds[0].settings.vnext[0].address;
    }
    return cfg;
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

