const logger = require('consola');
const { unblockMusicInPlaylist, unblockMusicWithSongId } = require('../service/sync_music');
const JobType = require('../consts/job_type');
const Source = require('../consts/source').consts;
const { matchUrlFromStr } = require('../utils/regex');
const { syncSingleSongWithUrl, syncPlaylist } = require('../service/sync_music');
const findTheBestMatchFromWyCloud = require('../service/search_songs/find_the_best_match_from_wycloud');
const JobManager = require('../service/job_manager');
const JobStatus = require('../consts/job_status');
const BusinessCode = require('../consts/business_code');


async function createJob(req, res) {
    const uid = req.account.uid;
    const request = req.body;

    const jobType = request.jobType;
    const options = request.options;
    let jobId = 0;

    if (jobType === JobType.UnblockedPlaylist || jobType === JobType.SyncThePlaylistToLocalService) {
        const source = request.playlist && request.playlist.source;
        const playlistId = request.playlist && request.playlist.id;

        if (source !== Source.Netease.code || !playlistId) {
            res.status(412).send({ 
                status: 1,
                message: "source or id is invalid",
            });
            return;
        }
        if (jobType === JobType.UnblockedPlaylist) {
            jobId = await unblockMusicInPlaylist(uid, source, playlistId, {
                syncWySong: options.syncWySong,
                syncNotWySong: options.syncNotWySong,
                asyncExecute: true,
            });
        } else {
            jobId = await syncPlaylist(uid, source, playlistId)
        }
    } else if (jobType === JobType.UnblockedSong) {
        const source = request.source;
        const songId = request.songId;

        if (source !== Source.Netease.code || !songId) {
            res.status(412).send({
                status: 1,
                message: "source or id is invalid",
            });
            return;
        }
        jobId = await unblockMusicWithSongId(uid, source, songId)
    } else if (jobType === JobType.SyncSongFromUrl || jobType === JobType.DownloadSongFromUrl) {
        const request = req.body;
        const url = request.urlJob && matchUrlFromStr(request.urlJob.url);

        if (!url) {
            res.status(412).send({
                status: 1,
                message: "url is invalid",
            });
            return;
        }

        let meta = {};
        const songId = request.urlJob && request.urlJob.meta.songId ? request.urlJob.meta.songId : "";
    
        if (request.urlJob.meta && (request.urlJob.meta.songName !== "" && request.urlJob.meta.artist !== "")) {
            meta = {
                songName: request.urlJob.meta.songName,
                artist: request.urlJob.meta.artist,
                album : request.urlJob.meta.album ? request.urlJob.meta.album : "",
            };
        }
    
        if (songId) {
            const songFromWyCloud = await findTheBestMatchFromWyCloud(req.account.uid, {
                songName: meta.songName,
                artist: meta.artist,
                album: meta.album,
                musicPlatformSongId: songId,
            });
            if (!songFromWyCloud) {
                logger.error(`song not found in wycloud`);
                res.status(412).send({
                    status: 1,
                    message: "can not find song in wycloud with your songId",
                });
                return;
            }
            meta.songFromWyCloud = songFromWyCloud;
        }
    
        // create job
        const args = `${jobType}: {"url":${url}}`;
        if (await JobManager.findActiveJobByArgs(uid, args)) {
            logger.info(`${jobType} job is already running.`);
            jobId = BusinessCode.StatusJobAlreadyExisted;
        } else {
            const operation = jobType === JobType.SyncSongFromUrl ? "上传" : "下载";
            jobId = await JobManager.createJob(uid, {
                name: `${operation}歌曲：${meta.songName ? meta.songName : url}`,
                args,
                type: jobType,
                status: JobStatus.Pending,
                desc: `歌曲：${meta.songName ? meta.songName : url}`,
                progress: 0,
                tip: `等待${operation}`,
                createdAt: Date.now()
            });
    
            // async job
            syncSingleSongWithUrl(req.account.uid, url, meta, jobId, jobType).then(async ret => {
                await JobManager.updateJob(uid, jobId, {
                    status: ret === true ? JobStatus.Finished : JobStatus.Failed,
                    progress: 1,
                    tip: ret === true ? `${operation}成功` : `${operation}失败`,
                });
            })
        }
    } else {
        res.status(412).send({
            status: 1,
            message: "jobType is not supported",
        });
        return;
    }

    if (jobId === false) {
        logger.error(`create job failed, uid: ${uid}`);
        res.status(412).send({
            status: 1,
            message: "create job failed",
        });
        return;
    }

    if (jobId === BusinessCode.StatusJobAlreadyExisted) {
        res.status(412).send({
            status: BusinessCode.StatusJobAlreadyExisted,
            message: "你的任务已经在跑啦，等等吧",
        });
        return;
    }
    if (jobId === BusinessCode.StatusJobNoNeedToCreate) {
        res.status(412).send({
            status: BusinessCode.StatusJobAlreadyExisted,
            message: "你的任务无需被创建，可能是因为没有需要 sync 的歌曲",
        });
        return;
    }

    res.status(201).send({
        status: jobId ? 0 : 1,
        data: {
            jobId,
        }
    });
}

async function listAllJobs(req, res) {
    res.send({
        status: 0,
        data: {
            jobs: await JobManager.listJobs(req.account.uid),
        }
    });
}

async function getJob(req, res) {
    res.send({
        status: 0,
        data: {
            jobs: await JobManager.getJob(req.account.uid, req.params.id),
        }
    });
}

module.exports = {
    createJob: createJob,
    listAllJobs: listAllJobs,
    getJob: getJob,
}