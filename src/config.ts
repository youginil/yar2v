import Ajv, { JSONSchemaType } from 'ajv';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { DataDir } from './constants';

const Server: JSONSchemaType<Server> = {
    type: 'object',
    properties: {
        id: {
            type: 'string',
        },
        name: {
            type: 'string',
        },
        host: {
            type: 'string',
        },
        url: {
            type: 'string',
        },
        cfg: {
            type: 'string',
        },
        delay: {
            type: 'number',
        },
        ability: {
            type: 'number',
        },
    },
    required: ['id', 'name', 'host', 'url', 'cfg', 'delay', 'ability'],
};

const schema: JSONSchemaType<Configuration> = {
    type: 'object',
    properties: {
        subscribe: {
            type: 'array',
            items: {
                type: 'string',
            },
            default: ['https://raw.fastgit.org/freefq/free/master/v2'],
        },
        'servers.user': {
            type: 'array',
            items: Server,
            default: [],
        },
        'servers.sub': {
            type: 'array',
            items: Server,
            default: [],
        },
        server: {
            type: 'string',
            default: '',
        },
        'main.http.host': {
            type: 'string',
            default: '127.0.0.1',
        },
        'main.http.port': {
            type: 'number',
            default: 1080,
        },
        'main.sock.host': {
            type: 'string',
            default: '127.0.0.1',
        },
        'main.sock.port': {
            type: 'number',
            default: 1090,
        },
        'main.api.host': {
            type: 'string',
            default: '127.0.0.1',
        },
        'main.api.port': {
            type: 'number',
            default: 1100,
        },
        'test.http.host': {
            type: 'string',
            default: '127.0.0.1',
        },
        'test.http.port': {
            type: 'number',
            default: 2080,
        },
        'test.sock.host': {
            type: 'string',
            default: '127.0.0.1',
        },
        'test.sock.port': {
            type: 'number',
            default: 2090,
        },
        'test.api.host': {
            type: 'string',
            default: '127.0.0.1',
        },
        'test.api.port': {
            type: 'number',
            default: 2100,
        },
        'log.level': {
            type: 'string',
            default: 'debug',
        },
    },
    required: [
        'subscribe',
        'servers.user',
        'servers.sub',
        'server',
        'main.http.host',
        'main.http.port',
        'main.sock.host',
        'main.sock.port',
        'main.api.host',
        'main.api.port',
        'test.http.host',
        'test.http.port',
        'test.sock.host',
        'test.sock.port',
        'test.api.host',
        'test.api.port',
        'log.level',
    ],
};

const validate = new Ajv({
    useDefaults: true,
    removeAdditional: true,
    coerceTypes: true,
}).compile(schema);

// @ts-ignore
let config: Configuration = {};

const cfgfile = path.join(DataDir, 'yar2v.json');

export async function saveConfig() {
    await fs.writeFile(cfgfile, JSON.stringify(config));
}

export async function loadConfig() {
    if (existsSync(cfgfile)) {
        const content = (await fs.readFile(cfgfile)).toString();
        const data = JSON.parse(content);
        if (!validate(data)) {
            throw new Error(JSON.stringify(validate.errors));
        }
        config = data;
    } else {
        validate(config);
        await saveConfig();
    }
}

export function getConfig<K extends keyof Configuration>(
    key: K
): Configuration[K] {
    return config[key];
}

export async function setConfig<K extends keyof Configuration>(
    key: K,
    value: Configuration[K]
) {
    config[key] = value;
    await saveConfig();
}

export function getAllServers(): {
    userServers: Server[];
    subServers: Server[];
} {
    return {
        userServers: config['servers.user'],
        subServers: config['servers.sub'],
    };
}

export function getCurrentServer(): Server | undefined {
    const list = [config['servers.user'], config['servers.sub']];
    for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < list[i].length; j++) {
            const server = list[i][j];
            if (server.id === config.server) {
                return server;
            }
        }
    }
}

