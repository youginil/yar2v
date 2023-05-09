import winston from 'winston';
import logger from './logger';
import { exec, ChildProcessWithoutNullStreams, spawn } from 'child_process';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import {
    DataDir,
    HttpInboundTag,
    MaxTesting,
    OutboundTag,
    SockInboundTag,
} from './constants';
import path from 'path';
import { getConfig } from './config';

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
    if (data.tls === 'xtls') {
        logger.error(`TODO xtls: ${url}`);
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
            tcpSettings:
                data.net === 'tcp'
                    ? {
                          header:
                              data.type === 'http'
                                  ? {
                                        type: 'http',
                                        request: {
                                            headers: {
                                                Host: data.host || '',
                                                path: (data.path || '')
                                                    .split(',')
                                                    .map((item: string) =>
                                                        item.trim()
                                                    )
                                                    .filter(
                                                        (item: string) => !!item
                                                    ),
                                            },
                                        },
                                    }
                                  : { type: 'none' },
                      }
                    : undefined,
            kcpSettings:
                data.net === 'kcp'
                    ? {
                          header: {
                              type: data.type || 'none',
                          },
                          seed: data.path,
                      }
                    : undefined,
            wsSettings:
                data.net === 'ws'
                    ? {
                          headers: {
                              Host: data.host || '',
                          },
                          path: data.path,
                      }
                    : undefined,
            httpSettings: ['h2', 'http'].includes(data.net)
                ? {
                      host: (data.host || '')
                          .split(',')
                          .map((item: string) => item.trim())
                          .filter((item: string) => !!item),
                      path: data.path || '/',
                  }
                : undefined,
            quicSettings:
                data.net === 'quic'
                    ? {
                          security: data.host || 'none',
                          key: data.path,
                          header: { type: data.type || 'none' },
                      }
                    : undefined,
            grpcSettings:
                data.net === 'grpc'
                    ? {
                          serviceName: data.path,
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

const parseSS: Parser = (url: string) => {
    const uo = new URL(url);
    const name = uo.hash ? decodeURIComponent(uo.hash.slice(1)) : uo.hostname;
    const [method, password] = Buffer.from(uo.username, 'base64')
        .toString()
        .split(':');
    const ob: Outbound = {
        protocol: 'shadowsocks',
        settings: {
            servers: [
                {
                    address: uo.hostname,
                    port: +uo.port,
                    method,
                    password,
                },
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
    { prefix: 'ss://', parser: parseSS },
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
            ob.tag = OutboundTag;
            cfg.outbounds.push(ob);
            return cfg;
        }
    }
    logger.error(`Invalid url: ${url}`);
}

const v2ray = path.join(DataDir, 'v2ray');

export class V2ray {
    private name: string;
    private cfgfile: string;
    private apiProxy: [string, number];
    private serverParam: string;
    private logger: winston.Logger;
    private proc: ChildProcessWithoutNullStreams | null = null;

    constructor(name: string, cfgfile: string, apiProxy: [string, number]) {
        this.name = name;
        this.cfgfile = cfgfile;
        this.apiProxy = apiProxy;
        this.serverParam = '-s ' + this.apiProxy[0] + ':' + this.apiProxy[1];
        this.logger = logger.child({ module: 'v2ray-' + name });
    }

    async run(inbounds: Inbound[], outbounds: Outbound[]) {
        this.logger.info('Start v2ray ' + this.name);
        if (this.proc) {
            this.logger.warning('V2ray already started');
            return;
        }

        const dir = path.dirname(this.cfgfile);
        if (!existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }
        const cfg: Omit<V2rayConfig, 'name' | 'host'> = {
            log: {
                access: '',
                error: '',
                loglevel: getConfig('v2ray.log.level'),
            },
            inbounds: [
                {
                    protocol: 'dokodemo-door',
                    listen: this.apiProxy[0],
                    port: this.apiProxy[1],
                    settings: { address: this.apiProxy[0] },
                    tag: 'api',
                },
                ...inbounds,
            ],
            outbounds,
            api: {
                tag: 'api',
                services: ['HandlerService', 'LoggerService', 'StatsService'],
            },
            routing: {
                rules: [
                    {
                        inboundTag: ['api'],
                        outboundTag: 'api',
                        type: 'field',
                    },
                    {
                        inboundTag: [HttpInboundTag, SockInboundTag],
                        outboundTag: OutboundTag,
                        type: 'field',
                    },
                    ...Array(MaxTesting).fill(0).map((_, i) => {
                        const tag = 'test-' + i;
                        return <Rule>{
                            inboundTag: [tag],
                            outboundTag: tag,
                            type: 'field',
                        };
                    }),
                ],
            },
        };

        await fs.writeFile(this.cfgfile, JSON.stringify(cfg));

        this.proc = spawn(v2ray, ['run', '-c', this.cfgfile]);

        this.proc.stdout.on('data', (data) => {
            this.logger.info(data.toString());
        });

        this.proc.stderr.on('data', (data) => {
            this.logger.error(data.toString());
        });

        this.proc.on('exit', (code) => {
            this.proc = null;
            if (code === 0) {
                this.logger.info('Exit normally');
            } else {
                this.logger.error(`Exit with code ${code}`);
            }
        });
    }

    stop() {
        this.logger.info('Stop v2ray ' + this.name + typeof this.proc);
        if (this.proc) {
            // sometimes SIGTERM not working
            if (!this.proc.kill('SIGKILL')) {
                throw new Error('Cannot stop v2ray');
            }
            this.proc = null;
        }
    }

    private async exec(
        ...params: string[]
    ): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            exec(v2ray + ' ' + params.join(' '), (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });
    }

    async stats() {
        return (await this.exec('api', 'stats', this.serverParam, '-runtime'))
            .stdout;
    }

    async addInbound(inbound: Inbound, file?: string) {
        if (!file) {
            file = this.cfgfile;
        }
        const cfg: Omit<V2rayConfig, 'name' | 'host'> = {
            inbounds: [inbound],
            outbounds: [],
        };
        await fs.writeFile(file, JSON.stringify(cfg));
        const { stdout, stderr } = await this.exec(
            'api',
            'adi',
            this.serverParam,
            file
        );
        if (stdout) {
            this.logger.info(stdout);
        }
        if (stderr) {
            this.logger.error(stderr);
            throw new Error(stderr);
        }
    }

    async rmInbound(...tags: string[]) {
        if (tags.length === 0) {
            return;
        }
        const { stdout, stderr } = await this.exec(
            'api',
            'rmi',
            this.serverParam,
            '--tags',
            tags.join(' ')
        );
        if (stdout) {
            this.logger.info(stdout);
        }
        if (stderr) {
            this.logger.error(stderr);
            throw new Error(stderr);
        }
    }

    async addOutbound(cfg: V2rayConfig, file?: string) {
        if (!file) {
            file = this.cfgfile;
        }
        await fs.writeFile(file, JSON.stringify(cfg));
        const { stdout, stderr } = await this.exec(
            'api',
            'ado',
            this.serverParam,
            file
        );
        if (stdout) {
            this.logger.info(stdout);
        }
        if (stderr) {
            this.logger.error(stderr);
            throw new Error(stderr);
        }
    }

    async rmOutbound(...tags: string[]) {
        if (tags.length === 0) {
            return;
        }
        const { stdout, stderr } = await this.exec(
            'api',
            'rmo',
            this.serverParam,
            '-tags',
            tags.join(' ')
        );
        if (stdout) {
            this.logger.info(stdout);
        }
        if (stderr) {
            this.logger.error(stderr);
            throw new Error(stderr);
        }
    }
}

