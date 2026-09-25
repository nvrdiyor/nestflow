# Tasvir AI — single-container deployment.
# The API (Fastify + built-in SQLite) serves both /api and the built web app.

# AutoCAD DWG reader (LibreDWG's dwg2dxf) — not packaged for Alpine, so it is
# built here once; Docker caches this stage across deploys.
FROM node:24-alpine AS libredwg
ARG LIBREDWG_VERSION=0.13.3
RUN apk add --no-cache build-base curl xz \
 && curl -sSfL https://ftp.gnu.org/gnu/libredwg/libredwg-${LIBREDWG_VERSION}.tar.xz | tar xJ -C /tmp \
 && cd /tmp/libredwg-${LIBREDWG_VERSION} \
 && ./configure --disable-bindings --disable-python --disable-shared --enable-static --disable-docs --disable-write >/dev/null \
 && make -j"$(nproc)" -C src >/dev/null \
 && make -j"$(nproc)" -C programs dwg2dxf >/dev/null \
 && strip programs/dwg2dxf \
 && install -m 755 programs/dwg2dxf /usr/local/bin/dwg2dxf \
 && mkdir -p /usr/local/share/libredwg \
 && (cp test/test-data/example_2000.dwg /usr/local/share/libredwg/ || true)

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
# Converters for uploads the browser cannot read: PDF / AI (poppler),
# EPS / PostScript (ghostscript), CorelDRAW (libcdr), DWG (LibreDWG).
RUN apk add --no-cache poppler-utils ghostscript libcdr-tools font-liberation
COPY --from=libredwg /usr/local/bin/dwg2dxf /usr/local/bin/dwg2dxf
COPY --from=libredwg /usr/local/share/libredwg /usr/local/share/libredwg
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
