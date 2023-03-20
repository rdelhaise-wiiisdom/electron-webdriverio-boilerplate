/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { spawn } from 'child_process';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
const webdriverio = require('webdriverio');
import { Promise as Es6Promise } from 'es6-promise';
import waitPort from 'wait-port';

function startDriverBin(bin: string, port: number) {
  return new Es6Promise((resolve, reject) => {
    try {
      const program = spawn(bin, [`--port=${port}`]);
      let isFirst = true;
      let stderr = '';
      program.stdout.on('data', data => {
        stderr += data.toString('utf8');
        log.debug('WEBDRIVER STDERR', stderr);
        // This detects driver instance get ready.
        if (!isFirst) {
          return;
        }
        isFirst = false;

        waitPort({
          port,
          host: 'localhost',
          timeout: 3000, // 3s
        })
          .then(() => {
            return resolve(program);
          })
          .catch(err => {
            console.log(err);
            reject(new Error(`Failed to start ChromeDriver: ${err}`));
          });
      });
      program.stderr.on('data', data => {
        stderr += data.toString('utf8');
        console.log('WEBDRIVER STDERR', stderr);
      });
      program.on('error', err => {
        console.log('WEBDRIVER ERROR', err);
        if (!isFirst) {
          return;
        }
        isFirst = false;
        reject(err);
      });
      program.on('close', () => {
        console.log('BROWSER WINDOW CLOSED');
      });
      program.on('exit', code => {
        if (!isFirst) {
          return;
        }
        isFirst = false;
        if (code === 0) {
          // webdriver some cases doesn't use exit codes correctly :(
          if (stderr.indexOf('Error:') === 0) {
            console.log(stderr);
            reject(new Error(stderr));
          } else {
            resolve(program);
          }
        } else {
          console.log(`Exit code: ${code}`);
          reject(new Error(`Exit code: ${code}`));
        }
      });
    } catch (err) {
      console.log(err);
      reject(err);
    }
  });
}

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

ipcMain.on('ipc-example', async (event, arg) => {
  const driver = await startDriverBin(path.resolve(__dirname, '../', 'resources', 'chromedriver'), 4445);
  try {
  const browser = await webdriverio.remote({
    port: 4445,
    path: '/',
    connectionRetryCount: 0,
    capabilities: {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: [],
        // Don't install automation extension, installing extensions to chrome may require admin privileges
        useAutomationExtension: false,
        // Disable same site cookie enformcement because Tableau Server on Windows doesn't like it
        localState: {
          'browser.enabled_labs_experiments': [
            'same-site-by-default-cookies@2',
            'cookies-without-same-site-must-be-secure@2',
          ],
        },
        prefs: {
          directory_upgrade: true,
          // prompt_for_download: false,
          download: {
            default_directory: "",
          },
        },
      },
    },
    logLevel: 'silent',
  });
  const userAgent = await browser.executeAsync((done: (userAgent: any) => any) => {
    done(navigator.userAgent);
  });
  } catch(e) {
    console.log("ERROR IN WEBDRIVER", e)
  }
  event.reply('ipc-example', 'pong');
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
