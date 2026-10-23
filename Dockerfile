# syntax=docker/dockerfile:1.7
# Multi-stage build: one image that serves the API and the built web app (same origin).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/radar-core/package.json packages/radar-core/
COPY packages/radar-adapters/package.json packages/radar-adapters/
COPY packages/radar-cli/package.json packages/radar-cli/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production SERVE_WEB=true PORT=4000
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/fixtures ./fixtures
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/src/server.js"]
