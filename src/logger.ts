import { createLogger, format, transports } from 'winston';
import { getConfig } from './config';
import { DataDir } from './constants';

const logger = createLogger({
    level: 'debug',
    format: format.combine(format.timestamp(), format.json(), format.prettyPrint()),
    transports: [
        new transports.File({
            dirname: DataDir,
            filename: 'yar2v.log',
        }),
    ],
});

export default logger;

