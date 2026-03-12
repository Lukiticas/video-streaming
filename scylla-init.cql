CREATE KEYSPACE IF NOT EXISTS openstream WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE openstream;

CREATE TABLE IF NOT EXISTS video_metadata (
    id uuid PRIMARY KEY,
    title text,
    description text,
    tags set<text>,
    size bigint,
    status text,
    manifest_url text,
    thumbnail_url text,
    created_at timestamp
);
