import winston from 'winston';
import logger from './logger';
import { exec, ChildProcessWithoutNullStreams, spawn } from 'child_process';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { DataDir } from './constants';
import path from 'path';

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
            ob.tag = 'remote';
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
    private httpProxy: [string, number];
    private sockProxy: [string, number];
    private apiProxy: [string, number];
    private serverParam: string;
    private logger: winston.Logger;
    private proc: ChildProcessWithoutNullStreams | null = null;

    constructor(
        name: string,
        cfgfile: string,
        httpProxy: [string, number],
        sockProxy: [string, number],
        apiProxy: [string, number]
    ) {
        this.name = name;
        this.cfgfile = cfgfile;
        this.httpProxy = httpProxy;
        this.sockProxy = sockProxy;
        this.apiProxy = apiProxy;
        this.serverParam = '-s ' + this.apiProxy[0] + ':' + this.apiProxy[1];
        this.logger = logger.child({ module: 'v2ray-' + name });
    }

    async run() {
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
            log: { access: '', error: '', loglevel: 'info' },
            inbounds: [
                {
                    protocol: 'dokodemo-door',
                    listen: this.apiProxy[0],
                    port: this.apiProxy[1],
                    settings: { address: this.apiProxy[0] },
                    tag: 'api',
                },
                {
                    protocol: 'http',
                    listen: this.httpProxy[0],
                    port: this.httpProxy[1],
                    tag: 'user-http',
                },
                {
                    protocol: 'socks',
                    listen: this.sockProxy[0],
                    port: this.sockProxy[1],
                    tag: 'user-socks',
                },
            ],
            outbounds: [],
            api: {
                tag: 'api',
                services: ['HandlerService', 'LoggerService', 'StatsService'],
            },
            routing: {
                rules: [
                    { inboundTag: ['api'], outboundTag: 'api', type: 'field' },
                    {
                        inboundTag: ['user-http', 'user-socks'],
                        outboundTag: 'remote',
                        type: 'field',
                    },
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
            this.logger.info(`v2ray ${this.name} exits`);
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

    async addOutbound(cfg: V2rayConfig) {
        await fs.writeFile(this.cfgfile, JSON.stringify(cfg));
        const { stdout } = await this.exec(
            'api',
            'ado',
            this.serverParam,
            this.cfgfile
        );
        this.logger.info(stdout);
    }

    async delOutbound(...tags: string[]) {
        if (tags.length > 0) {
            const { stdout } = await this.exec(
                'api',
                'rmo',
                this.serverParam,
                '-tags',
                tags.join(' ')
            );
            this.logger.info(stdout);
        }
    }
}

