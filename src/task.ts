import { ChildProcessWithoutNullStreams, exec, spawn } from 'child_process';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import ping from 'ping';
import { getAllServers, getConfig, saveConfig } from './config';
import { parseURL, setInbounds } from './formats';
import logger from './logger';
import { DataDir } from './constants';

type UpdateSubResult = {
    url: string;
    total: number;
    add: number;
    error: string;
};

let isUpdatingFromSub = false;

export function generateServerID(): string {
    return Date.now() + '-' + Math.random();
}

const uplog = logger.child({ module: 'subscribe' });

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
                                host: cfg.outbounds[0].settings.vnext[0]
                                    .address,
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
    }, 3600 * 1000);
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
    }, 5 * 60 * 1000);
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
        host: cfg.outbounds[0].settings.vnext[0].address,
        url,
        cfg: JSON.stringify(cfg),
    });
}

const v2ray = path.join(DataDir, 'v2ray');
const v2log = logger.child({ module: 'v2ray' });
const v2config = path.join(DataDir, 'config.json');
let v2proc: ChildProcessWithoutNullStreams | undefined;

async function execV2ray(
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

export function startV2ray() {
    v2log.info('Start v2ray');
    if (v2proc) {
        throw new Error('V2ray is running');
    }

    if (!existsSync(v2config)) {
        throw new Error('No config file, select a server first');
    }

    v2proc = spawn(v2ray, ['run', '-c', v2config]);
    v2proc.stdout.on('data', (data) => {
        v2log.info(data.toString());
    });
    v2proc.stderr.on('data', (data) => {
        v2log.error(data.toString());
    });
    v2proc.on('exit', (code) => {
        v2proc = undefined;
        if (code === 0) {
            v2log.info('Exit normally');
        } else {
            v2log.error(`Exit with code ${code}`);
        }
    });
}

export function stopV2ray() {
    v2log.info('Stop v2ray');
    if (v2proc) {
        if (v2proc.kill()) {
            v2proc = undefined;
        } else {
            throw new Error('Cannot stop v2ray');
        }
    }
}

function restartV2ray() {
    stopV2ray();
    startV2ray();
}

export function v2rayIsRunning() {
    return !!v2proc;
}

export async function selectServer(id: string) {
    const { userServers, subServers } = getAllServers();
    const allServers = [userServers, subServers];
    for (let i = 0; i < allServers.length; i++) {
        const servers = allServers[i];
        for (let j = 0; j < servers.length; j++) {
            const server = servers[j];
            if (server.id === id) {
                const cfg = JSON.parse(server.cfg);
                setInbounds(
                    cfg,
                    getConfig('local.http.host'),
                    getConfig('local.http.port'),
                    getConfig('local.sock.host'),
                    getConfig('local.sock.port')
                );
                await fs.writeFile(v2config, JSON.stringify(cfg));
                restartV2ray();
                return;
            }
        }
    }
    throw new Error('Invalid server ID');
}

