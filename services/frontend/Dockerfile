FROM alpine:3.24 AS builder
RUN apk add --no-cache nodejs npm     
WORKDIR /app
COPY package*.json ./
RUN npm ci 
COPY index.html ./
COPY vite.config.js ./
COPY src/ ./src/
RUN npm run build


FROM nginxinc/nginx-unprivileged:stable-alpine3.24
EXPOSE 8080
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/health || exit 1
USER 101

