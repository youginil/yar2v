import axios from 'axios';
import ping from 'ping';
import createHttpsAgent from 'https-proxy-agent';
import {
    getAllServers,
    getConfig,
    getCurrentServer,
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
                                delay: -1,
                                ability: -1,
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
    }, 6 * 3600 * 1000);
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
    await Promise.allSettled(
        servers.map(async (s) => {
            return ping.promise
                .probe(s.host, { timeout: 10 })
                .then((result) => {
                    if (result.alive) {
                        logger.debug(result);
                        s.delay = Math.ceil(+result.avg);
                    } else {
                        s.delay = -1;
                    }
                    pinglog.info(`${s.delay}ms ${s.host}`);
                })
                .catch((e) => {
                    pinglog.error(
                        `Fail to ping. server: ${s.id}. ${e.toString()}`
                    );
                });
        })
    );
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
    }, 2 * 60 * 1000);
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
        delay: -1,
        ability: -1,
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
    const curServer = getCurrentServer();
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

let isCheckingAbility = false;
export async function checkAbility(print2console = false) {
    const ablog = (print2console ? cslogger : logger).child({
        module: 'Ability',
    });
    ablog.info(`Check ability`);
    if (isCheckingAbility) {
        ablog.warn('The ability checking is in progress');
        return;
    }
    const { userServers, subServers } = getAllServers();
    const proxyHost = getConfig('test.http.host');
    const proxyPort = getConfig('test.http.port');
    const servers = [...userServers, ...subServers];
    const testUrl = 'https://google.com/';
    const request = axios.create({
        httpsAgent: createHttpsAgent(`http://${proxyHost}:${proxyPort}`),
        proxy: false,
        timeout: 10 * 1000,
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
        },
    });
    for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        if (server.delay < 0) {
            continue;
        }
        ablog.info(`Checking [${server.name}] ${server.host}`);
        const totalTimes = 3;
        let tryTimes = 0;
        while (tryTimes < totalTimes) {
            tryTimes++;
            ablog.info(`Trying (${tryTimes}/${totalTimes})...`);
            try {
                await v2test.changeOutbound(JSON.parse(server.cfg));
                const st = Date.now();
                const res = await request.get(testUrl);
                const dt = Date.now() - st;
                server.ability = dt;
                ablog.info(`Response: ${res.status}. Duration: ${dt}ms`);
                break;
            } catch (e) {
                server.ability = -1;
                ablog.error(e.toString());
            }
        }
    }
    await saveConfig();
}

let abTimer: NodeJS.Timer | null = null;
export function startAbilityTimer() {
    if (abTimer !== null) {
        throw new Error('Ability timer is already started');
    }
    abTimer = setInterval(() => {
        try {
            checkAbility();
        } catch (_) {
            //
        }
    }, 10 * 60 * 1000);
}

export function stopAbilityTimer() {
    if (abTimer !== null) {
        clearInterval(abTimer);
        abTimer = null;
    }
}

