const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
require('dotenv').config();

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

const app = express();
app.use(cors());
app.use(express.json());

const { initBucket, generatePresignedUrls } = require('./minio');
initBucket(logger);

const redisClient = new Redis(config.redis);
const redisSubscriber = new Redis(config.redis);
const REDIS_QUEUE = config.redis.queue;

const { client: scyllaClient, connectToScylla } = require('./db');
connectToScylla(logger).catch(err => {
  logger.error('Failed to connect to ScyllaDB on startup', err);
});

/**
 * Validates request payload for upload initialization
 */
app.post('/v1/upload/init', async (req, res) => {
  try {
    const { filename, fileSize, chunksCount } = req.body;

    if (!filename || !chunksCount) {
      return res.status(400).json({ error: 'Missing required arguments' });
    }

    const videoId = uuidv4();
    const fileKey = `${videoId}/original.mp4`;

    const urls = await generatePresignedUrls(videoId, chunksCount);

    const title = req.body.title || filename;
    const description = req.body.description || '';

    const query = `INSERT INTO video_metadata (id, title, description, size, status, created_at)
                   VALUES (?, ?, ?, ?, ?, toTimestamp(now()))`;
    await scyllaClient.execute(query, [videoId, title, description, fileSize, config.status.PENDING], { prepare: true });

    logger.info(`Initialized upload for ${videoId} with ${chunksCount} chunks`);

    res.json({
      uploadId: videoId,
      fileKey: fileKey,
      urls,
      chunksCount
    });

  } catch (error) {
    logger.error('Error initializing upload:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Complete the upload, queueing message in Redis
 */
app.post('/v1/upload/complete', async (req, res) => {
  try {
    const { uploadId, parts } = req.body;

    if (!uploadId || !parts) {
      return res.status(400).json({ error: 'Missing required arguments' });
    }

    const jobData = {
      videoId: uploadId,
      chunksCount: parts.length,
      status: config.status.PENDING,
      timestamp: Date.now()
    };

    await redisClient.xadd(REDIS_QUEUE, '*', 'job', JSON.stringify(jobData));

    const query = `UPDATE video_metadata SET status = ? WHERE id = ?`;
    await scyllaClient.execute(query, [config.status.PROCESSING, uploadId], { prepare: true });

    logger.info(`Queued video ${jobData.videoId} for processing`);

    res.status(202).json({
      message: 'Upload completed and queued for processing.',
      videoId: jobData.videoId
    });

  } catch (error) {
    logger.error('Error completing upload:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * SSE Endpoint for tracking video processing progress
 */
app.get('/v1/upload/:videoId/progress', (req, res) => {
  const { videoId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ status: 'CONNECTED', progress: 0 })}\n\n`);

  const onMessage = (channel, message) => {
    if (channel === 'video-progress') {
      try {
        const data = JSON.parse(message);
        if (data.videoId === videoId) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);

          if (data.status === config.status.CONCLUDED || data.status === config.status.FAILED) {
            res.end();
          }
        }
      } catch (err) {
        logger.error(`SSE Message parse error: ${err.message}`);
      }
    }
  };

  redisSubscriber.on('message', onMessage);

  req.on('close', () => {
    redisSubscriber.off('message', onMessage);
  });
});

redisSubscriber.subscribe(config.redis.progressChannel, (err) => {
  if (err) logger.error(`Failed to subscribe to ${config.redis.progressChannel}: ${err.message}`);
});

/**
 * Dummy Authentication endpoint for NGINX auth_request
 */
app.get('/v1/auth', (req, res) => {
  const authHeader = req.headers.authorization;

  if (authHeader === `Bearer ${config.auth.dummyToken}`) {
    return res.status(200).send('OK');
  }

  logger.warn(`Auth failed: Invalid or missing token from IP ${req.ip}`);
  return res.status(401).send('Unauthorized');
});

// Fetch all videos endpoint
app.get('/v1/videos', async (req, res) => {
  try {
    const result = await scyllaClient.execute('SELECT * FROM video_metadata');
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching videos from ScyllaDB:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

const PORT = config.server.port;
app.listen(PORT, () => {
  logger.info(`API Gateway listening on port ${PORT}`);
});
