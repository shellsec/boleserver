# BoleServer Docker deployment

The public image is `ghcr.io/shellsec/boleserver:latest` (Linux amd64/arm64). See [README](../README.md) for one-command installation, manual Compose, updates and password recovery.

Run `sudo bash deploy/install.sh` on a Linux server with Docker Engine and Compose installed. It pulls the image and installs under `/opt/boleserver`; an optional first argument chooses another absolute installation directory. Existing Compose files are preserved. The installer never installs Docker or modifies the firewall.

Visit `/admin/` to choose a password on a fresh installation. The standard Compose configuration does not set ADMIN_PASSWORD, so the password can be changed in the web UI and remains in data/config.js. Existing installations retain their passwords.

Persistent data/cache/music/cover_cache directories must be writable by UID 1000. Keep LICENSE and UPSTREAM-NOTICES.txt. No credentials, user files, sources or caches belong in images. Publishing does not update running servers.

Build from source: `docker build -t boleserver:local .`. The root Dockerfile compiles source in a builder stage; deploy/Dockerfile remains available for local packages with an already compiled server/ directory.

For gh-proxy.com acceleration, run with `BOLE_IMAGE=gh-proxy.com/docker/ghcr.io/shellsec/boleserver:latest`. The installer preserves other `.env` settings and stores this override. Leave BOLE_IMAGE unset for official GHCR access.
