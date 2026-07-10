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

# Stage 3: Production runtime
FROM node:20-alpine
ENV NODE_ENV=production
ENV PORT=4000

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

# Thư mục lưu ảnh nhận diện & ảnh nội dung (persist qua volume)
RUN mkdir -p uploads/media uploads/content && chown -R node:node /app/server/uploads

USER node
EXPOSE 4000

CMD ["node", "dist/index.js"]
