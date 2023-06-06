import typescript from '@rollup/plugin-typescript';

export default {
    input: 'src/main.ts',
    output: {
        file: 'dist/main.js',
        format: 'cjs',
        sourcemap: true,
    },
    plugins: [typescript()],
    external: [
        'electron',
        'path',
        'fs/promises',
        'fs',
        'child_process',
        'winston',
        'winston-daily-rotate-file',
        'ajv',
        'axios',
        'https-proxy-agent',
    ],
};

