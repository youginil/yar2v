import axios from 'axios';
import createHttpsAgent from 'https-proxy-agent';
import {
    getAllServers,
    getConfig,
    getServer,
    moveSub2User,
    saveConfig,
    setConfig,
} from './config';
import { V2ray, parseURL } from './v2ray';
import logger, { cslogger } from './logger';
import path from 'path';
import { DataDir } from './constants';

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
    const testUrl = 'https://www.google.com/generate_204';
    const request = axios.create({
        httpsAgent: createHttpsAgent(`http://${proxyHost}:${proxyPort}`),
        timeout: getConfig('conn.timeout') * 1000,
        proxy: false,
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
        },
    });
    for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        cclog.info(`Checking [${server.name}] ${server.host}`);
        try {
            await v2test.changeOutbound(JSON.parse(server.cfg));
            const st = Date.now();
            const res = await request.head(testUrl);
            const dt = Date.now() - st;
            server.conn = dt;
            server.connFails = 0;
            moveSub2User(server.id);
            cclog.info(`${res.status} ${res.statusText} ${dt}ms`);
        } catch (e) {
            server.conn = -1;
            server.connFails++;
            cclog.info(e.toString());
        } finally {
            server.connTime = Date.now();
        }
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

export async function clearFailedServers(): Promise<number> {
    const { userServers, subServers } = getAllServers();
    const list = [userServers, subServers];
    let n = 0;
    for (let i = 0; i < list.length; i++) {
        const ss = list[i];
        for (let j = 0; j < ss.length; j++) {
            const server = ss[j];
            if (server.connFails > 3) {
                ss.splice(j, 1);
                j--;
                n++;
            }
        }
    }
    if (n > 0) {
        await saveConfig();
    }
    return n;
}

