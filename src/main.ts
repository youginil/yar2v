import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import inquirer from 'inquirer';
import { DataDir } from './constants';
import { getAllServers, getConfig, loadConfig } from './config';
import {
    pingServers,
    selectServer,
    startPingTimer,
    startSubTimer,
    stopPingTimer,
    stopSubTimer,
    stopV2ray,
    updateSubServers,
    v2rayIsRunning,
} from './task';

async function selectAction() {
    const answers = await inquirer.prompt([
        {
            name: 'action',
            message: 'What do you want to do?',
            type: 'rawlist',
            choices: [
                {
                    name: 'Choose server',
                    value: 'servers',
                },
                {
                    name: 'Running status',
                    value: 'status',
                },
                {
                    name: 'Update subscribe',
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
                    name: 'Stop v2ray',
                    value: 'stop-v2ray',
                },
            ],
        },
    ]);
    switch (answers.action) {
        case 'status':
            if (v2rayIsRunning()) {
                console.log('V2ray is running');
            } else {
                console.log('V2ray is stopped');
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
            const httpHost = getConfig('local.http.host');
            const httpPort = getConfig('local.http.port');
            const sockHost = getConfig('local.sock.host');
            const sockPort = getConfig('local.sock.port');
            console.log(
                `export http_proxy=http://${httpHost}:${httpPort});export https_proxy=http://${httpHost}:${httpPort});export ALL_PROXY=socks5://${sockHost}:${sockPort}`
            );
            break;
        case 'stop-v2ray':
            try {
                stopV2ray();
            } catch (e) {
                console.error(e.message);
            }
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
    choices.push({ name: 'Back', value: '' });
    const answers = await inquirer.prompt([
        {
            name: 'server',
            message: 'Choose server',
            type: 'rawlist',
            choices,
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
    startSubTimer();
    startPingTimer();
    const sid = getConfig('server');
    if (sid) {
        try {
            await selectServer(sid);
            console.log('V2ray started');
        } catch (e) {
            console.error(e);
        }
    }

    process.on('SIGINT', () => {
        console.log('Bye Bye');
        try {
            stopV2ray();
            process.exit();
        } catch (e) {
            console.error(e.toString());
        }
    });

    while (true) {
        await selectAction();
        console.log('\n');
    }
})();

