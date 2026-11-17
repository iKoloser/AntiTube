FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN pnpm install --frozen-lockfile
COPY backend backend
RUN pnpm --filter @antitube/backend build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg python3 py3-pip \
  && pip install --no-cache-dir --break-system-packages yt-dlp
COPY --from=build /app/backend ./backend
COPY --from=build /app/node_modules ./node_modules
EXPOSE 4000
CMD ["node", "backend/dist/index.js"]
