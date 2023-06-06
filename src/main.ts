import { app } from 'electron';
import logger, { setLoggerLevel } from './logger';
import { getConfig, loadConfig } from './config';
import { startCheckTimer, startSubTimer, startV2ray, stopV2ray } from './task';
import { initTray } from './tray';

app.whenReady()
    .then(async () => {
        await loadConfig();
        setLoggerLevel(app.isPackaged ? getConfig('log.level') : 'debug');
        await startV2ray();
        startSubTimer();
        startCheckTimer();
        initTray();
        app.dock.hide();

        logger.info('App started');
    })
    .catch((e) => {
        logger.error(`Fail to start. ${e}`);
    });

app.on('will-quit', () => {
    try {
        stopV2ray();
    } catch (e) {
        logger.error(e.toString());
    }
});

