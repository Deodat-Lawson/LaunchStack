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

exec /entrypoint.sh server -s3 -s3.config=/etc/seaweedfs/s3-config.json \
  -filer -dir=/data -volume.max=0 \
  -master.volumeSizeLimitMB=1024 -volume.port=8080
