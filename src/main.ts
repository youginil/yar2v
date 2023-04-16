import { program } from 'commander';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import inquirer from 'inquirer';
import Ajv, { JSONSchemaType } from 'ajv';
import { homedir } from 'os';
import path from 'path';

interface Server {
    name: string;
    uri: string;
    delay?: number;
}

interface Configuration {
    subscribe: string;
    'servers.user': Server[];
    'servers.sub': Server[];
    server: string;
}

const schema: JSONSchemaType<Configuration> = {
    type: 'object',
    properties: {
        subscribe: {
            type: 'string',
            default: 'https://raw.fastgit.org/freefq/free/master/v2',
        },
        'servers.user': {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                    },
                    uri: {
                        type: 'string',
                    },
                    delay: {
                        type: 'number',
                        nullable: true,
                    },
                },
                required: ['name', 'uri'],
            },
            default: [],
        },
        'servers.sub': {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                    },
                    uri: {
                        type: 'string',
                    },
                    delay: {
                        type: 'number',
                        nullable: true,
                    },
                },
                required: ['name', 'uri'],
            },
            default: [],
        },
        server: {
            type: 'string',
            default: '',
        },
    },
    required: ['subscribe', 'servers.user', 'servers.sub', 'server'],
};

const validate = new Ajv({
    useDefaults: true,
    removeAdditional: true,
    coerceTypes: true,
}).compile(schema);

const cfgfile = path.resolve(homedir(), '.yar2v.json');
// @ts-ignore
let config: Configuration = {};

program.option('--v2ray <string>', 'v2ray command', 'v2ray');
program.parse();
const opts = program.opts();
const v2ray = opts.config;

async function saveConfig() {
    await fs.writeFile(cfgfile, JSON.stringify(config));
}

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

async function selectAction() {
    const answers = await inquirer.prompt([
        {
            name: 'action',
            message: 'What do you want to do?',
            type: 'rawlist',
            choices: [
                {
                    name: 'Running status',
                    value: 'status',
                },
                {
                    name: 'Show all servers',
                    value: 'servers',
                },
                {
                    name: 'Select server',
                    value: 'select-server',
                },
                {
                    name: 'Pull from subscriber',
                    value: 'subscribe',
                },
                {
                    name: 'Ping',
                    value: 'ping',
                },
                {
                    name: 'Exit',
                    value: 'exit',
                },
            ],
        },
    ]);
    console.log(answers);
    switch (answers.action) {
        case 'status':
        case 'servers':
        case 'select-server':
        case 'subscribe':
        case 'ping':
        case 'exit':
        default:
            console.error(`Invalid Action: ${answers.action}`);
    }
}

(async () => {
    let stat = await fs.stat(cfgfile).catch(() => null);
    if (stat && stat.isFile()) {
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

    await selectAction();
})();

