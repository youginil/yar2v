import { Menu, Tray, app, clipboard } from 'electron';
import path from 'path';
import { getAllServers, getConfig } from './config';
import { checkConnection, selectServer, updateSubServers } from './task';

let tray: Tray;

export function initTray() {
    tray = new Tray(
        path.resolve(app.getAppPath(), 'public/icon/iconTemplate.png')
    );
    buildTrayMenu();
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

export function buildTrayMenu() {
    const curID = getConfig('server');
    const { userServers, subServers } = getAllServers();
    const usids = userServers.map((item) => item.id);
    const servers = [...userServers, ...subServers];
    const protocols: string[] = [];
    let connMaxLen = 0;
    let connFailsMaxLen = 0;
    let protocolMaxLen = 0;
    for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        connMaxLen = Math.max(connMaxLen, server.conn.toString().length);
        connFailsMaxLen = Math.max(
            connFailsMaxLen,
            server.connFails.toString().length
        );
        const m = server.url.match(/^([^:]+):\/\//);
        const protocol = m ? m[1] : '';
        protocols.push(protocol);
        protocolMaxLen = Math.max(protocolMaxLen, protocol.length);
    }
    const choices: (Electron.MenuItem | Electron.MenuItemConstructorOptions)[] =
        servers.sort(compareServer).map((server, idx) => ({
            label: [
                usids.includes(server.id) ? 'U' : 'S',
                server.conn.toString().padStart(connMaxLen, ' ') + 'ms',
                ts2str(server.connTime),
                server.connFails.toString().padStart(connFailsMaxLen, ' '),
                protocols[idx].padStart(protocolMaxLen, ' '),
                server.name,
            ].join(' '),
            type: 'radio',
            checked: server.id === curID,
            async click() {
                await selectServer(server.id);
                buildTrayMenu();
            },
        }));

    const menu = Menu.buildFromTemplate([
        {
            label: 'Servers',
            type: 'submenu',
            submenu: Menu.buildFromTemplate(choices),
        },
        {
            label: 'Subscribe',
            click() {
                updateSubServers();
            },
        },
        {
            label: 'Check Servers',
            click() {
                checkConnection();
            },
        },
        {
            label: 'Copy Proxy Address',
            click() {
                const httpHost = getConfig('main.http.host');
                const httpPort = getConfig('main.http.port');
                const sockHost = getConfig('main.sock.host');
                const sockPort = getConfig('main.sock.port');
                const proxy = `export http_proxy=http://${httpHost}:${httpPort};export https_proxy=http://${httpHost}:${httpPort};export ALL_PROXY=socks5://${sockHost}:${sockPort}`;
                clipboard.writeText(proxy);
            },
        },
        {
            type: 'separator',
        },
        {
            label: 'Quit',
            click() {
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(menu);
}

