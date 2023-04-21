import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import inquirer from 'inquirer';
import { DataDir } from './constants';
import {
    getAllServers,
    getConfig,
    loadConfig,
    saveCurrentServer,
    setConfig,
} from './config';
import {
    checkConnection,
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

async function selectAction() {
    const answers = await inquirer.prompt([
        {
            name: 'action',
            message: 'What do you want to do?',
            type: 'rawlist',
            choices: [
                {
                    name: 'Choose Server',
                    value: 'servers',
                },
                {
                    name: 'Running Status',
                    value: 'status',
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
                    name: 'Clear Subcribed Servers',
                    value: 'clear-sub-servers',
                },
                {
                    name: 'Save Current Server',
                    value: 'save',
                },
            ],
            pageSize: 20,
        },
    ]);
    switch (answers.action) {
        case 'status':
            try {
                const stat = await runningStatus();
                console.log(stat);
            } catch (e) {
                console.error(e);
            }
            break;
        case 'servers':
            await chooseServer();
            break;
        case 'subscribe':
            stopSubTimer();
            try {
                await updateSubServers(true);
            } catch (e) {
                console.error(e.message);
            }
            startSubTimer();
        case 'ping':
            stopPingTimer();
            try {
                await pingServers(true);
            } catch (e) {
                console.error(e);
            }
            startPingTimer();
            await chooseServer();
            break;
        case 'connection':
            stopCheckTimer();
            try {
                await checkConnection(true);
            } catch (e) {
                //
            }
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
        case 'save':
            try {
                const server = await saveCurrentServer();
                if (server) {
                    console.log(`Saved [${server.name}] to user config`);
                }
            } catch (e) {
                console.error(e.message);
            }
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
                curID === server.id ? '*' : ' ',
                usids.includes(server.id) ? 'U' : 'S',
                server.conn.toString().padStart(len2 + 1, ' ') + 'ms',
                server.ping.toString().padStart(len3 + 1, ' ') + 'ms',
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
        try {
            await selectServer(answers.server);
        } catch (e) {
            console.error(e);
        }
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
            try {
                await selectServer(sid);
            } catch (e) {
                console.error(e);
            }
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

