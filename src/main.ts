import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import inquirer from 'inquirer';
import { DataDir } from './constants';
import {
    getAllServers,
    getConfig,
    getServer,
    loadConfig,
    setConfig,
} from './config';
import {
    checkConnection,
    importConfig,
    rmFailedServers,
    runningStatus,
    selectServer,
    startSubTimer,
    startV2ray,
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
                    name: 'Remove Failed Servers',
                    value: 'rm-failed',
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
            break;
        case 'connection':
            await tryRun(async () => await checkConnection(true), false);
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
        case 'rm-failed':
            await tryRun(async () => {
                const n = await rmFailedServers();
                if (n > 0) {
                    console.log('${n} failed servers removed');
                }
            });
            break;
        default:
            console.error(`Invalid Action: ${answers.action}`);
    }
}

function compareServer(a: Server, b: Server) {
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
    const len2 = servers.reduce(
        (r, item) => Math.max(r, item.conn.toString().length),
        0
    );
    const len3 = servers.reduce(
        (r, item) => Math.max(r, item.connFails.toString().length),
        0
    );
    const choices: { name: string; value: string }[] = servers
        .sort(compareServer)
        .map((server, idx) => ({
            name: [
                ' '.repeat(len1 - (idx + 1).toString().length),
                curID === server.id ? '@' : ' ',
                usids.includes(server.id) ? 'U' : 'S',
                server.conn.toString().padStart(len2, ' ') + 'ms',
                server.connFails.toString().padStart(len3, ' '),
                ts2str(server.connTime),
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
            pageSize: 30,
            default: '',
        },
    ]);
    if (answers.server) {
        const server = getServer(answers.server);
        if (server) {
            await tryRun(async () => await selectServer(answers.server));
        } else {
            console.warn(`Invalid Server`);
        }
        await chooseServer();
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

