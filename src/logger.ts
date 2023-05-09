import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { DataDir } from './constants';

const logger = createLogger({
    level: 'debug',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.json()
    ),
    transports: [
        new DailyRotateFile({
            dirname: DataDir,
            filename: 'log',
        }),
    ],
});

export const cslogger = createLogger({
    level: 'debug',
    format: format.combine(
        format.align(),
        format.colorize(),
        format.printf((info) => {
            return `${info.level} [${info.module ?? 'Global'}] ${
                typeof info.message === 'object'
                    ? JSON.stringify(info.message)
                    : info.message
            }`;
        })
    ),
    transports: [new transports.Console()],
});

export function setLoggerLevel(level: string) {
    logger.level = level;
    cslogger.level = level;
}

export default logger;

