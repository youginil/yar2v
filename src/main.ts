import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import inquirer from 'inquirer';
import { DataDir } from './constants';
import { getAllServers, getConfig, loadConfig, setConfig } from './config';
import {
    pingServers,
    selectServer,
    startPingTimer,
    startSubTimer,
    startV2ray,
    stopPingTimer,
    stopSubTimer,
    stopV2ray,
    updateSubServers,
    v2rayStats,
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
                    name: 'Proxy Address',
                    value: 'proxy',
                },
                {
                    name: 'Clear Subcribed Servers',
                    value: 'clear-sub-servers',
                },
            ],
        },
    ]);
    switch (answers.action) {
        case 'status':
            try {
                const stat = await v2rayStats();
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
                const list = await updateSubServers();
                if (list) {
                    list.forEach((item) => {
                        console.log(item);
                    });
                }
            } catch (e) {
                console.error(e.message);
            }
            startSubTimer();
            await chooseServer();
            break;
        case 'ping':
            stopPingTimer();
            try {
                await pingServers();
            } catch (e) {
                console.error(e);
            }
            startPingTimer();
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
        default:
            console.error(`Invalid Action: ${answers.action}`);
    }
}

async function chooseServer() {
    const { userServers, subServers } = getAllServers();
    const userServerLen = userServers.length;
    const choices: { name: string; value: string }[] = [
        ...userServers,
        ...subServers,
    ].map((server, idx) => ({
        name: [
            idx < userServerLen ? 'U' : 'S',
            (server.delay ? server.delay : -1).toString().padStart(5, ' ') +
                'ms',
            server.name,
        ].join(' '),
        value: server.id,
    }));
    choices.unshift({ name: 'Back', value: '' });
    const answers = await inquirer.prompt([
        {
            name: 'server',
            message: 'Choose server',
            type: 'rawlist',
            choices,
            pageSize: 20,
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

