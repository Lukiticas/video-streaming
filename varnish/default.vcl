vcl 4.1;

backend default {
    .host = "minio";
    .port = "9000";
}

sub vcl_recv {
    # Remove cookies so caching works purely on the URL
    if (req.url ~ "\.(m3u8|ts|mp4)$") {
        unset req.http.Cookie;
        return (hash);
    }
}

sub vcl_backend_response {
    # Cache .ts HLS segments aggressively since they are immutable
    if (bereq.url ~ "\.ts$") {
        set beresp.ttl = 24h;
        set beresp.http.Cache-Control = "public, max-age=86400";
    }
    
    # Playlists can be cached for a short time (mostly for VOD, maybe longer but 10s is safe)
    if (bereq.url ~ "\.m3u8$") {
        set beresp.ttl = 10m;
        set beresp.http.Cache-Control = "public, max-age=600";
    }
}
