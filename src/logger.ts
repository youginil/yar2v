import { app } from 'electron';
import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const LogDir = app.getPath('logs');

const logger = createLogger({
    level: 'debug',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.json()
    ),
    transports: [
        new DailyRotateFile({
            dirname: LogDir,
            filename: 'log',
        }),
    ],
});

export const todologger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.json()
    ),
    transports: [new transports.File({ filename: 'todo', dirname: LogDir })],
});

export function setLoggerLevel(level: string) {
    logger.level = level;
}

export default logger;

