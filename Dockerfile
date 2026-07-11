# NestFlow AI — single-container deployment.
# The API (Fastify + built-in SQLite) serves both /api and the built web app.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w @nestflow/engine \
 && npm run build -w @nestflow/web \
 && npm run build -w @nestflow/api

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist

ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
# Persist the SQLite database + auto-generated JWT secret across restarts.
VOLUME ["/app/apps/api/data"]
CMD ["node", "apps/api/dist/index.js"]
