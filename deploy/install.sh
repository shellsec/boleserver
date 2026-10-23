#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf '\n错误：%s\n' "$*" >&2; exit 1; }
trap 'printf "\n安装未完成，请检查上方错误；已有数据目录不会被删除。\n" >&2' ERR
[[ $(uname -s) == Linux ]] || fail '此脚本用于 Linux Docker 服务器。'
[[ $EUID -eq 0 ]] || fail '请使用 sudo bash install.sh 或 root 用户执行。'
command -v docker >/dev/null || fail '请先安装 Docker Engine 和 Docker Compose 插件。'
docker info >/dev/null 2>&1 || fail 'Docker 服务未运行或当前用户无权访问。'
docker compose version >/dev/null 2>&1 || fail '缺少 docker compose 插件。'

bole_dir=${1:-/opt/boleserver}
[[ $bole_dir == /* && $bole_dir != / ]] || fail '安装目录必须为绝对路径，且不能是根目录。'
mkdir -p "$bole_dir"
bole_dir=$(cd "$bole_dir" && pwd -P)
cd "$bole_dir"
# Pull before modifying the installation, so unavailable images do not disrupt it.
bole_image=${BOLE_IMAGE:-ghcr.io/shellsec/boleserver:latest}
[[ $bole_image =~ ^[a-zA-Z0-9./:_@-]+$ ]] || fail 'BOLE_IMAGE 不是有效镜像地址。'
docker pull "$bole_image"
if [[ -n ${BOLE_IMAGE:-} ]]; then
  bole_env=$(mktemp "$bole_dir/.env.bole.XXXXXX")
  chmod 600 "$bole_env"
  if [[ -f .env ]]; then awk '!/^BOLE_IMAGE=/' .env > "$bole_env"; fi
  printf 'BOLE_IMAGE=%s\n' "$BOLE_IMAGE" >> "$bole_env"
  mv "$bole_env" "$bole_dir/.env"
fi
for folder in data cache music cover_cache; do
  install -d -o 1000 -g 1000 -m 0755 "$bole_dir/$folder"
done
if [[ -f compose.yaml ]]; then
  bole_compose=compose.yaml
elif [[ -f docker-compose.yml ]]; then
  bole_compose=docker-compose.yml
else
  bole_compose=compose.yaml
  cat > "$bole_compose" <<'COMPOSE'
# Save as /opt/boleserver/compose.yaml. First visit /admin/ to choose a password.
services:
  boleserver:
    image: ${BOLE_IMAGE:-ghcr.io/shellsec/boleserver:latest}
    container_name: boleserver
    restart: unless-stopped
    ports:
      - "9527:9527"
    environment:
      NODE_ENV: production
      DATA_PATH: /server/data
      LOG_PATH: /server/data/logs
      PORT: "9527"
      DISABLE_TELEMETRY: "true"
      TZ: Asia/Shanghai
    volumes:
      - ./data:/server/data
      - ./cache:/server/cache
      - ./music:/server/music
      - ./cover_cache:/server/cover_cache
COMPOSE
fi
docker compose -f "$bole_compose" config --services | grep -qx boleserver || fail '现有 Compose 未包含 boleserver 服务，请检查安装目录。'
docker compose -f "$bole_compose" up -d boleserver
bole_id=$(docker compose -f "$bole_compose" ps -q boleserver)
[[ -n $bole_id ]] || fail '未找到已启动容器。'
for ((attempt=0; attempt<60; attempt++)); do
  bole_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$bole_id")
  if [[ $bole_health == healthy ]]; then
    bole_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    bole_binding=$(docker compose -f "$bole_compose" port boleserver 9527 | head -n 1)
    bole_port=${bole_binding##*:}
    printf '\nBoleServer 已启动。目录：%s\n'  "$bole_dir"
    printf '后台：http://%s:%s/admin/\n播放器：http://%s:%s/\n' "${bole_ip:-服务器IP}" "${bole_port:-9527}" "${bole_ip:-服务器IP}" "${bole_port:-9527}"
    printf '首次进入后台设置管理密码；已有安装继续使用原密码。\n'
    printf '音源入口：播放器 → 设置 → 系统 → 管理员登录 → 管理 / 添加 → 音源订阅清单。\n'
    exit 0
  fi
  [[ $bole_health != exited && $bole_health != unhealthy ]] || break
  sleep 2
done
docker compose -f "$bole_compose" logs --tail 40 boleserver
fail '容器尚未通过健康检查，请检查日志和端口占用。'
