const logger = require('consola');
const https = require('https');
const cmd = require('../../utils/cmd');
var isWin = require('os').platform().indexOf('win32') > -1;
const isLinux = require('os').platform().indexOf('linux') > -1;
const isDarwin = require('os').platform().indexOf('darwin') > -1;
const httpsGet = require('../../utils/network').asyncHttpsGet;
const RemoteConfig = require('../remote_config');
const fs = require('fs');

function getBinPath(isTemp = false) {
    return `${__dirname}/../../../bin/media-get` + (isTemp ? '-tmp-' : '') + (isWin ? '.exe' : '');
}

async function getMediaGetInfo(isTempBin = false) {
    const {code, message} = await cmd(getBinPath(isTempBin), ['-h']);
    if (code != 0) {
        logger.error(`please install media-get first`);
        return false;
    }

    const hasInstallFFmpeg = message.indexOf('FFmpeg,FFprobe: installed') > -1;
    const versionInfo = message.match(/Version:(.+?)\n/);

    return {
        hasInstallFFmpeg,
        versionInfo: versionInfo ? versionInfo[1].trim() : '',
        fullMessage: message,
    }
}

async function getLatestMediaGetVersion() {
    const remoteConfig = await RemoteConfig.getRemoteConfig();
    const latestVerisonUrl = `${remoteConfig.bestGithubProxy}https://raw.githubusercontent.com/foamzou/media-get/main/LATEST_VERSION`;
    console.log('start to get latest version from: ' + latestVerisonUrl);

    const latestVersion = await httpsGet(latestVerisonUrl);
    console.log('latest version: ' + latestVersion);
    if (latestVersion === null || (latestVersion || "").split('.').length !== 3) {
        logger.error('获取 media-get 最新版本号失败, got: ' + latestVersion);
        return false;
    }
    return latestVersion;
}

async function downloadFile(url, filename) {
    return new Promise((resolve) => {
        let fileStream = fs.createWriteStream(filename);
        let receivedBytes = 0;

        const handleResponse = (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302) {
                logger.info('Following redirect');
                fileStream.end();
                fileStream = fs.createWriteStream(filename);
                if (res.headers.location) {
                    https.get(res.headers.location, handleResponse)
                        .on('error', handleError);
                }
                return;
            }

            // Check for successful status code
            if (res.statusCode !== 200) {
                handleError(new Error(`HTTP Error: ${res.statusCode}`));
                return;
            }

            const totalBytes = parseInt(res.headers['content-length'], 10);

            res.on('error', handleError);
            fileStream.on('error', handleError);

            res.pipe(fileStream);

            res.on('data', (chunk) => {
                receivedBytes += chunk.length;
            });

            fileStream.on('finish', () => {
                fileStream.close(() => {
                    if (receivedBytes === 0) {
                        fs.unlink(filename, () => {
                            logger.error('Download failed: Empty file received');
                            resolve(false);
                        });
                    } else if (totalBytes && receivedBytes < totalBytes) {
                        fs.unlink(filename, () => {
                            logger.error(`Download incomplete: ${receivedBytes}/${totalBytes} bytes`);
                            resolve(false);
                        });
                    } else {
                        resolve(true);
                    }
                });
            });
        };

        const handleError = (error) => {
            fileStream.destroy();
            fs.unlink(filename, () => {
                logger.error('Download error:', error);
                resolve(false);
            });
        };

        const req = https.get(url, handleResponse)
            .on('error', handleError)
            .setTimeout(60000, () => {
                handleError(new Error('Download timeout'));
            });

        req.on('error', handleError);
    });
}

async function getMediaGetRemoteFilename(latestVersion) {
    let suffix = 'win.exe';
    if (isLinux) {
        suffix = 'linux';
    }
    if (isDarwin) {
        suffix = 'darwin';
    }
    if (process.arch === 'arm64') {
        suffix += '-arm64';
    }
    const remoteConfig = await RemoteConfig.getRemoteConfig();
    return `${remoteConfig.bestGithubProxy}https://github.com/foamzou/media-get/releases/download/v${latestVersion}/media-get-${latestVersion}-${suffix}`;
}

const renameFile = (oldName, newName) => {
    return new Promise((resolve, reject) => {
      fs.rename(oldName, newName, (err) => {
        if (err) {
            logger.error(err)
            resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  };

async function downloadTheLatestMediaGet(version) {
    const remoteFile = await getMediaGetRemoteFilename(version);
    logger.info('start to download media-get: ' + remoteFile);
    const ret = await downloadFile(remoteFile, getBinPath(true));
    if (ret === false) {
        logger.error('download failed');
        return false;
    }
    fs.chmodSync(getBinPath(true), '755');
    logger.info('download finished');
    
    const temBinInfo = await getMediaGetInfo(true)
    if (!temBinInfo
         || temBinInfo.versionInfo === ""
        ) {
        logger.error('testing new bin failed. Don`t update', temBinInfo)
        return false;
    }

    const renameRet = await renameFile(getBinPath(true), getBinPath());
    if (!renameRet) {
        logger.error('rename failed');
        return false;
    }
    return true;
}

module.exports = {
    getBinPath: getBinPath,
    getMediaGetInfo: getMediaGetInfo,
    getLatestMediaGetVersion: getLatestMediaGetVersion,
    downloadTheLatestMediaGet: downloadTheLatestMediaGet,
}