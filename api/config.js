require('dotenv').config();

module.exports = {
  server: {
    port: parseInt(process.env.PORT || '8080', 10),
  },
  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    buckets: {
      uploads: process.env.MINIO_BUCKET_UPLOADS || 'uploads',
      processed: process.env.MINIO_BUCKET_PROCESSED || 'processed'
    }
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    queue: process.env.REDIS_QUEUE || 'video-processing-queue',
    progressChannel: process.env.REDIS_PROGRESS_CHANNEL || 'video-progress'
  },
  scylla: {
    host: process.env.SCYLLA_HOST || 'scylla',
    localDataCenter: process.env.SCYLLA_DATACENTER || 'datacenter1',
    keyspace: process.env.SCYLLA_KEYSPACE || 'openstream'
  },
  auth: {
    dummyToken: process.env.DUMMY_AUTH_TOKEN || 'openstream-secret-token'
  },
  status: {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    CONCLUDED: 'CONCLUDED',
    FAILED: 'FAILED'
  }
};
