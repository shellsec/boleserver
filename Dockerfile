FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm --ignore-scripts run build

FROM node:24-bookworm-slim
WORKDIR /server
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg libchromaprint-tools && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=builder /build/server ./server
COPY public ./public
COPY scripts ./scripts
COPY index.js config.js LICENSE UPSTREAM-NOTICES.txt ./
RUN chown node:node /server
ENV NODE_ENV=production DATA_PATH=/server/data LOG_PATH=/server/data/logs PORT=9527 DISABLE_TELEMETRY=true TZ=Asia/Shanghai
USER node
EXPOSE 9527
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "require('http').get('http://127.0.0.1:9527/js/config.js',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "index.js"]
