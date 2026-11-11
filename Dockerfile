# ShortsPilot AI — production image (Next.js + FFmpeg + SQLite on a persistent volume)
FROM node:22-bookworm-slim

# ffmpeg = video rendering, fonts-dejavu = caption font, openssl = Prisma engine
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-core openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/data/db/app.db \
    UPLOAD_DIR=/data/uploads \
    NEXT_TELEMETRY_DISABLED=1

VOLUME ["/data"]
EXPOSE 3000
CMD ["sh", "scripts/docker-entrypoint.sh"]
