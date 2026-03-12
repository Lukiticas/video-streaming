const cassandra = require('cassandra-driver');

const config = require('./config');

const client = new cassandra.Client({
  contactPoints: [config.scylla.host],
  localDataCenter: config.scylla.localDataCenter,
  keyspace: config.scylla.keyspace
});

async function connectToScylla(logger) {
  try {
    await client.connect();
    if (logger) logger.info('Connected to ScyllaDB successfully.');
  } catch (err) {
    if (logger) logger.error('Error connecting to ScyllaDB:', err);
    throw err;
  }
}

module.exports = { client, connectToScylla };
