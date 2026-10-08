# syntax=docker/dockerfile:1

# Stage 1: Build frontend (Vite -> /app/dist)
FROM node:20-alpine AS client-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Build backend (tsc -> /app/server/dist)
FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Stage 3: auto-video-gen deps (tsx + pipeline — NO chromium download)
FROM node:20-alpine AS video-builder
WORKDIR /app/auto-video-gen
COPY auto-video-gen/package*.json ./
# Tắt Puppeteer auto-download Chrome: Chrome sẽ được cài bởi apk trong runtime
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install
COPY auto-video-gen/ ./

# Stage 4: Production runtime
FROM node:20-alpine
ENV NODE_ENV=production
ENV PORT=4000

# Chromium + FFmpeg cho auto-video-gen (HyperFrames render + audio processing)
# Ghi chú: nss, freetype, harfbuzz cần thiết để Chromium chạy trong Alpine
RUN apk add --no-cache \
      ffmpeg \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

# Trỏ Puppeteer / HyperFrames đến Chromium của hệ thống (không download riêng)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV CHROME_PATH=/usr/bin/chromium-browser
# Cho phép chạy Chromium trong container không có sandbox (cần thiết trong Docker)
ENV CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox"

# Server chạy từ /app/server/dist/index.js, phục vụ client build ở /app/dist,
# lưu ảnh vào /app/server/uploads. Giữ đúng cấu trúc này để các path tương đối khớp.
WORKDIR /app/server

# Chỉ cài dependency production cho backend
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy server đã build
COPY --from=server-builder /app/server/dist ./dist

# Copy client build ra /app/dist (server đọc từ ../../dist)
COPY --from=client-builder /app/dist /app/dist

# Copy auto-video-gen (source + node_modules với tsx/hyperframes/etc.)
COPY --from=video-builder /app/auto-video-gen /app/auto-video-gen

# Thư mục lưu ảnh nhận diện, ảnh nội dung, video AI (persist qua volume)
RUN mkdir -p uploads/media uploads/content uploads/videos \
    && chown -R node:node /app/server/uploads \
    && chown -R node:node /app/auto-video-gen

USER node
EXPOSE 4000

CMD ["node", "dist/index.js"]
