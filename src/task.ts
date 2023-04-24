import axios from 'axios';
import ping from 'ping';
import createHttpsAgent from 'https-proxy-agent';
import {
    delSubServers,
    getAllServers,
    getConfig,
    getServer,
    saveConfig,
    setConfig,
} from './config';
import { V2ray, parseURL } from './v2ray';
import logger, { cslogger } from './logger';
import path from 'path';
import { DataDir } from './constants';

let isUpdatingFromSub = false;

function generateServerID() {
    return Date.now() + '-' + Math.random();
}

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
                                ping: -1,
                                pingFailedTimes: 0,
                                conn: -1,
                                connFailedTimes: 0,
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

let pinging = false;
export async function pingServers(print2console = false) {
    const pinglog = (print2console ? cslogger : logger).child({
        module: 'ping',
    });
    pinglog.info('Ping...');
    if (pinging) {
        throw new Error('Pinging');
    }
    const { userServers, subServers } = getAllServers();
    const servers = [...userServers, ...subServers];
    if (servers.length === 0) {
        return;
    }
    const serversWillRemoved: string[] = [];
    await Promise.allSettled(
        servers.map(async (s) => {
            return ping.promise
                .probe(s.host, { timeout: 10 })
                .then((result) => {
                    if (result.alive) {
                        s.ping = Math.ceil(+result.avg);
                        s.pingFailedTimes = 0;
                    } else {
                        s.ping = -1;
                        s.pingFailedTimes++;
                        if (s.pingFailedTimes >= 10 && s.conn < 0) {
                            serversWillRemoved.push(s.id);
                        }
                    }
                    pinglog.info(`${s.ping}ms ${s.host}`);
                })
                .catch((e) => {
                    pinglog.info(
                        `Fail to ping. server: ${s.id}. ${e.toString()}`
                    );
                });
        })
    );
    if (serversWillRemoved.length > 0) {
        delSubServers(...serversWillRemoved);
    }
    await saveConfig();
}

let pingTimer: NodeJS.Timer | null = null;

export function startPingTimer() {
    if (pingTimer !== null) {
        throw new Error('Ping timer is already started');
    }
    pingTimer = setInterval(() => {
        try {
            pingServers();
        } catch (e) {
            logger.error(`Fail to ping. ${e.toString()}`);
        }
    }, getConfig('ping.interval') * 1000);
}

export function stopPingTimer() {
    if (pingTimer !== null) {
        clearInterval(pingTimer);
        pingTimer = null;
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
        ping: -1,
        pingFailedTimes: 0,
        conn: -1,
        connFailedTimes: 0,
    });
}

const v2mainCfgfile = path.join(DataDir, 'v2ray.main.json');
let v2main: V2ray;

const v2testCfgfile = path.join(DataDir, 'v2ray.test.json');
let v2test: V2ray;

export async function startV2ray() {
    v2main = new V2ray(
        'main',
        v2mainCfgfile,
        [getConfig('main.http.host'), getConfig('main.http.port')],
        [getConfig('main.sock.host'), getConfig('main.sock.port')],
        [getConfig('main.api.host'), getConfig('main.api.port')]
    );
    await v2main.run();

    v2test = new V2ray(
        'test',
        v2testCfgfile,
        [getConfig('test.http.host'), getConfig('test.http.port')],
        [getConfig('test.sock.host'), getConfig('test.sock.port')],
        [getConfig('test.api.host'), getConfig('test.api.port')]
    );
    await v2test.run();
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
                await v2main.changeOutbound(JSON.parse(server.cfg));
                await setConfig('server', id);
                return;
            }
        }
    }
}

let isCheckingConnection = false;
export async function checkConnection(print2console = false) {
    const cclog = (print2console ? cslogger : logger).child({
        module: 'Connection',
    });
    cclog.info(`Check connection`);
    if (isCheckingConnection) {
        cclog.warn('The connection checking is in progress');
        return;
    }
    const { userServers, subServers } = getAllServers();
    const proxyHost = getConfig('test.http.host');
    const proxyPort = getConfig('test.http.port');
    const servers = [...userServers, ...subServers];
    const testUrl = 'https://google.com/';
    const request = axios.create({
        httpsAgent: createHttpsAgent(`http://${proxyHost}:${proxyPort}`),
        timeout: 10 * 1000,
        proxy: false,
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
        },
    });
    const serversWillRemoved: string[] = [];
    for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        if (server.ping < 0 && server.conn < 0) {
            continue;
        }
        cclog.info(`Checking [${server.name}] ${server.host}`);
        try {
            await v2test.changeOutbound(JSON.parse(server.cfg));
            const st = Date.now();
            const res = await request.head(testUrl);
            const dt = Date.now() - st;
            server.conn = dt;
            server.connFailedTimes = 0;
            cclog.info(`${res.status} ${res.statusText} ${dt}ms`);
            break;
        } catch (e) {
            server.conn = -1;
            server.connFailedTimes++;
            if (server.connFailedTimes >= 10) {
                serversWillRemoved.push(server.id);
            }
            cclog.info(e.toString());
        }
    }
    if (serversWillRemoved.length > 0) {
        // todo not accurate enough
        //         delSubServers(...serversWillRemoved);
    }
    await saveConfig();
}

let checkTimer: NodeJS.Timer | null = null;
export function startCheckTimer() {
    if (checkTimer !== null) {
        throw new Error('Check timer is already started');
    }
    checkTimer = setInterval(() => {
        try {
            checkConnection();
        } catch (_) {
            //
        }
    }, getConfig('conn.interval') * 1000);
}

export function stopCheckTimer() {
    if (checkTimer !== null) {
        clearInterval(checkTimer);
        checkTimer = null;
    }
}

