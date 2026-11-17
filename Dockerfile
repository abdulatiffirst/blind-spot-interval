FROM node:24-bookworm-slim AS build
ENV VITE_BACKEND=legacy
WORKDIR /app
COPY package*.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/memory-engine/package.json packages/memory-engine/package.json
COPY packages/calendar-scheduler/package.json packages/calendar-scheduler/package.json
COPY functions/package.json functions/package.json
RUN npm ci
COPY . .
RUN npm run build
FROM build AS runtime
ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["npm","run","start:api"]
FROM nginx:stable-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
