const Redis = require('ioredis');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
require('dotenv').config();

const { downloadChunks, uploadFolderToMinio, cleanUploadChunks } = require('./minio');
const { transcodeToHLS, getVideoDuration, generateSpriteSheets } = require('./ffmpeg');
const config = require('./config');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

const redisClient = new Redis({
  host: config.redis.host,
  port: config.redis.port
});

const OUTPUT_DIR = config.worker.outputDir;
const REDIS_QUEUE = config.worker.redisQueue;
const CONSUMER_GROUP = config.worker.consumerGroup;
const CONSUMER_NAME = config.worker.consumerName;

const { client: scyllaClient, connectToScylla } = require('./db');
connectToScylla(logger).catch(err => {
  logger.error('Failed to connect to ScyllaDB on startup', err);
});

async function setupRedis() {
  try {
    await redisClient.xgroup('CREATE', REDIS_QUEUE, CONSUMER_GROUP, '0', 'MKSTREAM');
    logger.info(`Created consumer group ${CONSUMER_GROUP}`);
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) {
      logger.error('Error creating consumer group:', err);
    }
  }
}

async function processJob(jobId, jobDataStr) {
  let workDir;
  let outputPath;
  try {
    const job = JSON.parse(jobDataStr);
    logger.info(`Processing job ${job.videoId}`);

    workDir = path.join(os.tmpdir(), job.videoId);
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    const inputPath = await downloadChunks(logger, job.videoId, job.chunksCount, workDir);
    outputPath = path.join(OUTPUT_DIR, job.videoId);

    const duration = await getVideoDuration(logger, inputPath);
    logger.info(`[Video Info] ${job.videoId} duration: ${duration}s`);

    await transcodeToHLS(logger, inputPath, OUTPUT_DIR, job.videoId, duration, (percent) => {
      const progressMsg = {
        videoId: job.videoId,
        progress: percent,
        status: config.status.PROCESSING
      };

      redisClient.publish('video-progress', JSON.stringify(progressMsg)).catch(err => {
        logger.error(`Failed to publish progress for ${job.videoId}: ${err.message}`);
      });
    });

    const thumbnailPath = path.join(outputPath, 'thumbnail.jpg');
    logger.info(`Extracting thumbnail for ${job.videoId}...`);

    await new Promise((resolve, _) => {
      execFile('ffmpeg', ['-y', '-i', inputPath, '-ss', '00:00:01.000', '-vframes', '1', thumbnailPath], (error, stdout, stderr) => {
        if (error) {
          logger.error(`Failed to extract thumbnail: ${stderr}`);
          return resolve();
        }

        resolve();
      });
    });

    logger.info(`Extracting Sprite Sheets for ${job.videoId}...`);

    try {
      await generateSpriteSheets(logger, inputPath, OUTPUT_DIR, job.videoId, duration);
      logger.info(`[Thumbnail VTT] Sprite sheets and VTT generation finished.`);

      const vttCheckPath = path.join(OUTPUT_DIR, job.videoId, 'thumbnails.vtt');
      if (fs.existsSync(vttCheckPath)) {
        logger.info(`[Thumbnail VTT] SUCCESS: thumbnails.vtt exists at ${vttCheckPath}`);
        const contentPreview = fs.readFileSync(vttCheckPath, 'utf8').substring(0, 50);
        logger.info(`[Thumbnail VTT] File content preview: ${contentPreview.replace(/\n/g, '\\n')}`);
      } else {
        logger.error(`[Thumbnail VTT] ERROR: thumbnails.vtt WAS NOT FOUND at ${vttCheckPath}`);
      }
    } catch (spriteErr) {
      logger.error(`Failed to generate VTT sprite sheets: ${spriteErr.message}`);
    }

    logger.info(`Uploading transcoded files, thumbnail & sprite sheets to MinIO...`);
    await uploadFolderToMinio(logger, outputPath, job.videoId);

    await cleanUploadChunks(logger, job.videoId, job.chunksCount);

    const manifestUrl = `${config.api.publicUrl}/processed/${job.videoId}/master.m3u8`;
    const thumbnailUrl = `${config.api.publicUrl}/processed/${job.videoId}/thumbnail.jpg`;

    await scyllaClient.execute(
      `UPDATE video_metadata SET status = ?, manifest_url = ?, thumbnail_url = ? WHERE id = ?`,
      [config.status.CONCLUDED, manifestUrl, thumbnailUrl, job.videoId],
      { prepare: true }
    );

    const finalMsg = {
      videoId: job.videoId,
      progress: 100,
      status: config.status.CONCLUDED
    };

    await redisClient.publish(config.redis.progressChannel, JSON.stringify(finalMsg));

    logger.info(`Job ${job.videoId} successfully completed! Manifest: ${manifestUrl}`);

    try {
      await redisClient.xack(REDIS_QUEUE, CONSUMER_GROUP, jobId);
    } catch (ackErr) {
      logger.error(`Failed to ack message ${jobId}:`, ackErr);
    }
  } catch (err) {
    logger.error(`Failed to process job ${jobId}: ${err.message}`, { stack: err.stack });

    const job = JSON.parse(jobDataStr);
    if (job && job.videoId) {
      try {
        await scyllaClient.execute(
          `UPDATE video_metadata SET status = ? WHERE id = ?`,
          [config.status.FAILED, job.videoId],
          { prepare: true }
        );

        logger.info(`Job ${job.videoId} marked as FAILED in ScyllaDB.`);

        await cleanUploadChunks(logger, job.videoId, job.chunksCount);
      } catch (dbErr) {
        logger.error(`Could not set FAILED status for ${job.videoId}: ${dbErr.message}`);
      }
    }
  } finally {
    if (workDir && fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
      logger.info(`Cleaned up temporary workspace: ${workDir}`);
    }

    if (outputPath && fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, { recursive: true, force: true });
      logger.info(`Cleaned up processing output: ${outputPath}`);
    }
  }
}

async function pollQueue() {
  try {
    const results = await redisClient.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', 1,
      'BLOCK', 5000,
      'STREAMS', REDIS_QUEUE, '>'
    );

    if (results && results.length > 0) {
      const stream = results[0];
      const messages = stream[1];

      for (const message of messages) {
        const [messageId, messageData] = message;
        const jobIndex = messageData.indexOf('job');
        if (jobIndex !== -1) {
          const jobStr = messageData[jobIndex + 1];
          await processJob(messageId, jobStr);
        }
      }
    }
  } catch (err) {
    logger.error('Error reading from queue:', err);
  }

  setImmediate(pollQueue);
}

async function start() {
  await setupRedis();
  logger.info('Worker started, polling for jobs...');
  pollQueue();
}

start();
