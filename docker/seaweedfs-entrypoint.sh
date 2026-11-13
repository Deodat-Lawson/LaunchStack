#!/bin/sh
# Generate s3-config.json from environment variables at startup
cat > /etc/seaweedfs/s3-config.json <<EOF
{
    "identities": [
        {
            "name": "pdr_admin",
            "credentials": [
                {
                    "accessKey": "${S3_ACCESS_KEY:-pdr_local_key}",
                    "secretKey": "${S3_SECRET_KEY:-pdr_local_secret}"
                }
            ],
            "actions": ["Admin","Read","List","Tagging","Write","WriteAcp","ReadAcp"]
        },
        {
            "name": "anonymous",
            "actions": ["Read"]
        }
    ]
}
EOF

# S3_PORT: the self-host stack (deploy/compose.yml) makes the S3 port inside
# the container match the published one, so one files URL works from a browser
# and from other containers. Everything else leaves it at 8333.
exec /entrypoint.sh server -s3 -s3.port="${S3_PORT:-8333}" \
  -s3.config=/etc/seaweedfs/s3-config.json \
  -filer -dir=/data -volume.max=0 \
  -master.volumeSizeLimitMB=1024 -volume.port=8080
