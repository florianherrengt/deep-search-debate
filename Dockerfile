FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY src/api/package.json src/api/package.json
COPY src/web/package.json src/web/package.json

RUN npm ci

COPY . .
RUN npm run build:web

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/src/api ./src/api
COPY --from=build --chown=node:node /app/src/web/package.json ./src/web/package.json
COPY --from=build --chown=node:node /app/src/web/dist ./src/web/dist

RUN chmod 400 /app/src/api/secrets/dev.kdbx /app/src/api/secrets/prod.kdbx \
  && mkdir -p /app/data \
  && chown node:node /app/data

USER node

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV PORT=3000
ENV AUTH_DEBUG_USER_ENABLED=false

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "@deep-search-debate/api"]
