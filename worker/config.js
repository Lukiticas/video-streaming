require('dotenv').config();
const os = require('os');
const path = require('path');

module.exports = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10)
  },
  worker: {
    outputDir: process.env.WORKER_OUTPUT_DIR || path.join(os.tmpdir(), 'hls_output'),
    redisQueue: process.env.REDIS_QUEUE || 'video-processing-queue',
    consumerGroup: process.env.CONSUMER_GROUP || 'ffmpeg-workers',
    consumerName: `worker-${process.pid}`
  },
  scylla: {
    host: process.env.SCYLLA_HOST || 'scylla',
    localDataCenter: process.env.SCYLLA_DATACENTER || 'datacenter1',
    keyspace: process.env.SCYLLA_KEYSPACE || 'openstream'
  },
  api: {
    publicUrl: process.env.API_PUBLIC_URL || 'http://localhost:8000'
  },
  ffmpeg: {
    resolutions: [
      { name: '1080p', scale: '1920x1080', bitrate: '5000k' },
      { name: '720p', scale: '1280x720', bitrate: '2800k' },
      { name: '480p', scale: '854x480', bitrate: '1400k' },
      { name: '240p', scale: '426x240', bitrate: '400k' }
    ],
    hlsTime: process.env.FFMPEG_HLS_TIME || '10'
  },
  status: {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    CONCLUDED: 'CONCLUDED',
    FAILED: 'FAILED'
  }
};
