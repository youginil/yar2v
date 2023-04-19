import axios from 'axios';
import ping from 'ping';
import { getAllServers, getConfig, saveConfig, setConfig } from './config';
import { V2ray, parseURL } from './v2ray';
import logger from './logger';
import path from 'path';
import { DataDir } from './constants';

type UpdateSubResult = {
    url: string;
    total: number;
    add: number;
    error: string;
};

let isUpdatingFromSub = false;

const uplog = logger.child({ module: 'subscribe' });

function generateServerID() {
    return Date.now() + '-' + Math.random();
}

export async function updateSubServers(): Promise<UpdateSubResult[] | false> {
    uplog.info('Start updating servers...');
    if (isUpdatingFromSub) {
        uplog.warn(
            'Updating servers from subscribe srouce is in progress, please wait...'
        );
        return false;
    }
    const rs: UpdateSubResult[] = [];
    const urls = getConfig('subscribe');
    await Promise.allSettled(
        urls.map(async (url) => {
            const s: UpdateSubResult = { url, total: 0, add: 0, error: '' };
            rs.push(s);
            return axios
                .get(url)
                .then(async (r) => {
                    const { userServers, subServers } = getAllServers();
                    uplog.debug({ url, response: r.data });
                    const items = Buffer.from(r.data as string, 'base64')
                        .toString()
                        .split('\n');
                    s.total = items.length;
                    items.forEach((item) => {
                        item = item.trim();
                        if (
                            item &&
                            !subServers.some((it) => it.url === item) &&
                            !userServers.some((it) => it.url === item)
                        ) {
                            const cfg = parseURL(item);
                            if (!cfg) {
                                uplog.error(`Fail to parse url: ${url}`);
                                return;
                            }
                            subServers.push({
                                id: generateServerID(),
                                name: cfg.name,
                                host: cfg.host,
                                url: item,
                                cfg: JSON.stringify(cfg),
                            });
                            s.add++;
                            uplog.info({ sub: url, config: item });
                        }
                    });
                })
                .catch((e) => {
                    uplog.error({ url, err: e });
                });
        })
    );
    await saveConfig();
    uplog.info('Updating end');
    return rs;
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
const pinglog = logger.child({ module: 'ping' });
export async function pingServers() {
    pinglog.info('Start ping...');
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
                })
                .catch((e) => {
                    pinglog.error(
                        `Fail to ping. server: ${s.id}. err: ${e.toString()}`
                    );
                });
        })
    );
    await saveConfig();
    pinglog.info('Ping end');
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

export async function v2rayStats() {
    return await v2main.stats();
}

export async function selectServer(id: string) {
    const { userServers, subServers } = getAllServers();
    const allServers = [userServers, subServers];
    for (let i = 0; i < allServers.length; i++) {
        const servers = allServers[i];
        for (let j = 0; j < servers.length; j++) {
            const server = servers[j];
            if (server.id === id) {
                const curServer = getConfig('server');
                if (curServer) {
                    await v2main.delOutbound(curServer);
                }
                await v2main.addOutbound(JSON.parse(server.cfg));
                await setConfig('server', id);
                return;
            }
        }
    }
}

