import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import inquirer from 'inquirer';
import { DataDir } from './constants';
import {
    getAllServers,
    getConfig,
    getServer,
    isUserServer,
    loadConfig,
    moveSub2User,
    moveUser2Sub,
    setConfig,
} from './config';
import {
    checkConnection,
    clearNotConnectedServers,
    importConfig,
    pingServers,
    runningStatus,
    selectServer,
    startCheckTimer,
    startPingTimer,
    startSubTimer,
    startV2ray,
    stopCheckTimer,
    stopPingTimer,
    stopSubTimer,
    stopV2ray,
    updateSubServers,
} from './task';
import { setLoggerLevel } from './logger';

async function tryRun(f: () => Promise<any>, printError = true) {
    try {
        await f();
    } catch (e) {
        if (printError) {
            console.error(e.message);
        }
    }
}

function ts2str(ts: number) {
    if (ts === 0) {
        return '--:--';
    }
    const t = new Date(ts);
    return (
        `${t.getHours()}`.padStart(2, '0') +
        ':' +
        `${t.getMinutes()}`.padStart(2, '0')
    );
}

async function selectAction() {
    const answers = await inquirer.prompt([
        {
            name: 'action',
            message: 'What do you want to do?',
            type: 'rawlist',
            choices: [
                {
                    name: 'Servers',
                    value: 'servers',
                },
                {
                    name: 'Running Status',
                    value: 'status',
                },
                {
                    name: 'Import',
                    value: 'import',
                },
                {
                    name: 'Subscribe',
                    value: 'subscribe',
                },
                {
                    name: 'Ping',
                    value: 'ping',
                },
                {
                    name: 'Check Connection',
                    value: 'connection',
                },
                {
                    name: 'Proxy Address',
                    value: 'proxy',
                },
                {
                    name: 'Clear User Servers',
                    value: 'clear-user-servers',
                },
                {
                    name: 'Clear Sub Servers',
                    value: 'clear-sub-servers',
                },
                {
                    name: 'Clear Not-Connected Servers',
                    value: 'clear-not-connected',
                },
            ],
            pageSize: 20,
        },
    ]);
    switch (answers.action) {
        case 'status':
            await tryRun(async () => {
                const stat = await runningStatus();
                console.log(stat);
            });
            break;
        case 'servers':
            await chooseServer();
            break;
        case 'import':
            const ans = await inquirer.prompt([
                {
                    name: 'url',
                    message: 'Enter URL',
                    type: 'input',
                },
            ]);
            const url = ans.url.trim();
            if (url) {
                await tryRun(async () => {
                    await importConfig(url);
                });
                await chooseServer();
            }
            break;
        case 'subscribe':
            stopSubTimer();
            await tryRun(async () => await updateSubServers(true));
            startSubTimer();
        case 'ping':
            stopPingTimer();
            await tryRun(async () => await pingServers(true));
            startPingTimer();
            await chooseServer();
            break;
        case 'connection':
            stopCheckTimer();
            await tryRun(async () => await checkConnection(true), false);
            startCheckTimer();
            await chooseServer();
            break;
        case 'proxy':
            const httpHost = getConfig('main.http.host');
            const httpPort = getConfig('main.http.port');
            const sockHost = getConfig('main.sock.host');
            const sockPort = getConfig('main.sock.port');
            console.log(
                `export http_proxy=http://${httpHost}:${httpPort};export https_proxy=http://${httpHost}:${httpPort};export ALL_PROXY=socks5://${sockHost}:${sockPort}`
            );
            break;
        case 'clear-sub-servers':
            await setConfig('servers.sub', []);
            break;
        case 'clear-user-servers':
            await setConfig('servers.user', []);
            break;
        case 'clear-not-connected':
            const n = await clearNotConnectedServers();
            console.log(`${n} server(s) removed`);
            break;
        default:
            console.error(`Invalid Action: ${answers.action}`);
    }
}

function compareServer(a: Server, b: Server) {
    if (a.conn === b.conn) {
        if (a.ping < 0) {
            return 1;
        }
        if (b.ping < 0) {
            return -1;
        }
        return a.ping - b.ping;
    }
    if (a.conn < 0) {
        return 1;
    }
    if (b.conn < 0) {
        return -1;
    }
    return a.conn - b.conn;
}

async function chooseServer() {
    const curID = getConfig('server');
    const { userServers, subServers } = getAllServers();
    const usids = userServers.map((item) => item.id);
    const servers = [...userServers, ...subServers];
    const len1 = servers.length.toString().length;
    const [len2, len3] = servers.reduce(
        (r, item) => [
            Math.max(r[0], item.conn.toString().length),
            Math.max(r[1], item.ping.toString().length),
        ],
        [0, 0]
    );
    const choices: { name: string; value: string }[] = servers
        .sort(compareServer)
        .map((server, idx) => ({
            name: [
                ' '.repeat(len1 - (idx + 1).toString().length),
                curID === server.id ? '@' : ' ',
                usids.includes(server.id) ? 'U' : 'S',
                server.conn.toString().padStart(len2 + 1, ' ') + 'ms',
                ts2str(server.connTime),
                server.ping.toString().padStart(len3 + 1, ' ') + 'ms',
                ts2str(server.pingTime),
                server.name,
            ].join(' '),
            value: server.id,
        }));
    choices.push({ name: 'Back', value: '' });
    const answers = await inquirer.prompt([
        {
            name: 'server',
            message: 'Choose server',
            type: 'rawlist',
            choices,
            pageSize: 20,
            default: '',
        },
    ]);
    if (answers.server) {
        const server = getServer(answers.server);
        if (server) {
            const isus = isUserServer(server.id);
            const answers = await inquirer.prompt([
                {
                    name: 'action',
                    message: `What to do with [${server.name}]?`,
                    type: 'rawlist',
                    choices: [
                        {
                            name: 'Back',
                            value: '',
                        },
                        {
                            name: 'Active',
                            value: 'active',
                        },
                        {
                            name: isus
                                ? 'Move to Subscribe Servers'
                                : 'Move to User Servers',
                            value: isus ? 'u2s' : 's2u',
                        },
                    ],
                },
            ]);
            switch (answers.action) {
                case 'active':
                    await tryRun(async () => await selectServer(server.id));
                    break;
                case 'u2s':
                    await tryRun(async () => await moveUser2Sub(server.id));
                    break;
                case 's2u':
                    await tryRun(async () => await moveSub2User(server.id));
                    break;
                default:
                    break;
            }
            await chooseServer();
        } else {
            console.warn(`Invalid Server`);
        }
        await tryRun(async () => await selectServer(answers.server));
    }
}

(async () => {
    if (!existsSync(DataDir) || !(await fs.stat(DataDir)).isDirectory()) {
        await fs.mkdir(DataDir, { recursive: true });
    }
    await loadConfig();
    setLoggerLevel(getConfig('log.level'));
    await startV2ray();
    startSubTimer();
    startPingTimer();
    startCheckTimer();

    const sid = getConfig('server');
    if (sid) {
        setTimeout(async () => {
            await tryRun(async () => await selectServer(sid));
        }, 1000);
    }

    process.on('SIGINT', () => {
        try {
            stopV2ray();
            process.exit();
        } catch (e) {
            console.error(e.toString());
        }
    });

    while (true) {
        await selectAction();
    }
})();

