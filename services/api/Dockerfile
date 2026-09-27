FROM alpine:3.24 AS builder
RUN apk add --no-cache nodejs npm     
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund
COPY server.js ./

FROM alpine:3.24 
RUN apk add --no-cache nodejs 
ARG USER_ID=1001
ARG GROUP_ID=1001
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
EXPOSE 3000
RUN addgroup -g ${GROUP_ID} -S appgroup && \
  adduser -u ${USER_ID} -S -D -G appgroup -s /sbin/nologin appuser
COPY --chown=appuser:appgroup --from=builder /app/server.js ./server.js
COPY --chown=appuser:appgroup --from=builder /app/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=builder /app/package.json ./package.json
USER ${USER_ID}
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
