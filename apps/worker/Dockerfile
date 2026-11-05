FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "require('fs').statSync('/tmp/worker.alive')&&Date.now()-require('fs').statSync('/tmp/worker.alive').mtimeMs<30000||process.exit(1)"
CMD ["node", "dist/src/index.js"]
