import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
    getAllServers,
    getConfig,
    getServer,
    saveConfig,
    setConfig,
} from './config';
import { V2ray, parseURL } from './v2ray';
import logger, { cslogger } from './logger';
import path from 'path';
import {
    DataDir,
    HttpInboundTag,
    MaxTesting,
    OutboundTag,
    SockInboundTag,
} from './constants';

function generateServerID() {
    return Date.now() + '-' + Math.random();
}

export async function importConfig(url: string) {
    const cfg = parseURL(url);
    if (!cfg) {
        throw new Error('Invalid url');
    }
    const userServers = getConfig('servers.user');
    userServers.push({
        id: generateServerID(),
        name: cfg.name,
        host: cfg.host,
        url,
        cfg: JSON.stringify(cfg),
        conn: -1,
        connTime: 0,
        connFails: 0,
    });
    await saveConfig();
}

let isUpdatingFromSub = false;
export async function updateSubServers(print2console = false) {
    const uplog = (print2console ? cslogger : logger).child({
        module: 'subscribe',
    });
    uplog.info('Start updating servers...');

    if (isUpdatingFromSub) {
        uplog.warn(
            'Updating servers from subscribe srouce is in progress, please wait...'
        );
        return false;
    }
    const urls = getConfig('subscribe');
    await Promise.allSettled(
        urls.map(async (url) => {
            return axios
                .get(url)
                .then(async (r) => {
                    uplog.info(`Subscribe from ${url}`);
                    const { userServers, subServers } = getAllServers();
                    const items = Buffer.from(r.data as string, 'base64')
                        .toString()
                        .split('\n');
                    items.forEach((item) => {
                        item = item.trim();
                        if (
                            item &&
                            !subServers.some((it) => it.url === item) &&
                            !userServers.some((it) => it.url === item)
                        ) {
                            const cfg = parseURL(item);
                            if (!cfg) {
                                uplog.error(`Fail to parse url: ${item}`);
                                return;
                            }
                            subServers.push({
                                id: generateServerID(),
                                name: cfg.name,
                                host: cfg.host,
                                url: item,
                                cfg: JSON.stringify(cfg),
                                conn: -1,
                                connTime: 0,
                                connFails: 0,
                            });
                            uplog.info(`${item}`);
                        }
                    });
                })
                .catch((e) => {
                    uplog.error(e.toString());
                });
        })
    );
    await saveConfig();
}

let subTimer: NodeJS.Timer | null = null;

export function startSubTimer() {
    if (subTimer !== null) {
        throw new Error('Subscribe timer started');
    }
    subTimer = setInterval(async () => {
        try {
            await updateSubServers();
        } catch (e) {
            logger.error(`Fail to update from  subscriber. ${e.toString()}`);
        }
    }, getConfig('sub.interval') * 1000);
}

export function stopSubTimer() {
    if (subTimer !== null) {
        clearInterval(subTimer);
        subTimer = null;
    }
}

export function addUserConfig(url: string): string | undefined {
    const { userServers, subServers } = getAllServers();
    if ([...userServers, ...subServers].some((item) => item.url === url)) {
        return 'Duplicate URL';
    }
    const cfg = parseURL(url);
    if (!cfg) {
        return 'Invalid URL';
    }
    userServers.push({
        id: generateServerID(),
        name: cfg.name,
        host: cfg.host,
        url,
        cfg: JSON.stringify(cfg),
        conn: -1,
        connTime: 0,
        connFails: 0,
    });
}

const v2mainCfgfile = path.join(DataDir, 'v2ray.main.json');
let v2main: V2ray;

const v2testCfgfile = path.join(DataDir, 'v2ray.test.json');
let v2test: V2ray;

export async function startV2ray() {
    const server = getServer();
    const outbounds: Outbound[] = [];
    if (server) {
        const cfg: V2rayConfig = JSON.parse(server.cfg);
        outbounds.push(...cfg.outbounds);
    }
    v2main = new V2ray('main', v2mainCfgfile, [
        getConfig('main.api.host'),
        getConfig('main.api.port'),
    ]);
    await v2main.run(
        [
            {
                protocol: 'http',
                listen: getConfig('main.http.host'),
                port: getConfig('main.http.port'),
                tag: HttpInboundTag,
            },
            {
                protocol: 'socks',
                listen: getConfig('main.sock.host'),
                port: getConfig('main.sock.port'),
                tag: SockInboundTag,
            },
        ],
        outbounds
    );

    v2test = new V2ray('test', v2testCfgfile, [
        getConfig('test.api.host'),
        getConfig('test.api.port'),
    ]);
    await v2test.run([], []);
}

export function stopV2ray() {
    v2main.stop();
    v2test.stop();
}

export async function runningStatus() {
    const curServer = getServer();
    return curServer ? curServer.name + ' ' + curServer.host : 'Not running';
}

export async function selectServer(id: string) {
    const { userServers, subServers } = getAllServers();
    const allServers = [userServers, subServers];
    for (let i = 0; i < allServers.length; i++) {
        const servers = allServers[i];
        for (let j = 0; j < servers.length; j++) {
            const server = servers[j];
            if (server.id === id) {
                await v2main.rmOutbound(OutboundTag);
                await v2main.addOutbound(JSON.parse(server.cfg));
                await setConfig('server', id);
                return;
            }
        }
    }
}

let isCheckingConnection = false;
export function checkConnection(print2console = false): Promise<void> {
    const cclog = (print2console ? cslogger : logger).child({
        module: 'Connection',
    });
    if (isCheckingConnection) {
        cclog.warn('The connection checking is in progress');
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const { userServers, subServers } = getAllServers();
        const servers = [...userServers, ...subServers];

        let testingNum = 0;
        let index = -1;
        let port = 10000;

        async function testConnection(server: Server, tag: string) {
            testingNum++;
            cclog.info(`Checking [${server.name}] ${server.host}`);
            const h = '127.0.0.1';
            let p = ++port;
            try {
                const cfg: V2rayConfig = JSON.parse(server.cfg);
                cfg.outbounds[0].tag = tag;
                const cfgfile = path.join(DataDir, tag + '.json');
                await v2test.addOutbound(cfg, cfgfile);
                while (true) {
                    try {
                        await v2test.addInbound(
                            {
                                protocol: 'http',
                                listen: h,
                                port: p,
                                tag: tag,
                            },
                            cfgfile
                        );
                        break;
                    } catch (e) {
                        cclog.error(e.toString());
                        // todo check if busy port
                        p = ++port;
                    }
                }
                const request = axios.create({
                    httpsAgent: new HttpsProxyAgent(`http://${h}:${p}`),
                    timeout: getConfig('conn.timeout') * 1000,
                    proxy: false,
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
                    },
                });
                const st = Date.now();
                await request.head('https://www.google.com/');
                const dt = Date.now() - st;
                server.conn = dt;
                server.connFails = 0;
            } catch (e) {
                server.conn = -1;
                server.connFails++;
            } finally {
                server.connTime = Date.now();
                testingNum--;
                await v2test.rmOutbound(tag);
                await v2test.rmInbound(tag);
            }
            if (index === servers.length - 1) {
                if (testingNum === 0) {
                    isCheckingConnection = false;
                    await saveConfig();
                    resolve();
                }
                return;
            }
            index += 1;
            testConnection(servers[index], tag);
        }

        for (let i = 0; i < Math.min(MaxTesting, servers.length); i++) {
            index = i;
            const server = servers[i];
            testConnection(server, 'test-' + i);
        }
    });
}

export async function rmFailedServers(): Promise<number> {
    const { userServers, subServers } = getAllServers();
    const list = [userServers, subServers];
    let num = 0;
    for (let i = 0; i < list.length; i++) {
        const ss = list[i];
        for (let j = 0; j < ss.length; j++) {
            const server = ss[j];
            if (server.connFails >= 3) {
                ss.splice(j, 1);
                j--;
                num++;
            }
        }
    }
    if (num > 0) {
        await saveConfig();
    }
    return num;
}

