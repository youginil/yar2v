import { createLogger, format, transports } from 'winston';
import { DataDir } from './constants';

const logger = createLogger({
    level: 'debug',
    format: format.combine(
        format.timestamp(),
        format.json(),
        format.prettyPrint()
    ),
    transports: [
        new transports.File({
            dirname: DataDir,
            filename: 'yar2v.log',
        }),
        new transports.File({
            dirname: DataDir,
            filename: 'yar2v.error.log',
            level: 'error',
        }),
    ],
});

export function setLoggerLevel(level: string) {
    logger.level = level;
}

export default logger;

