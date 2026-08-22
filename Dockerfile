FROM node:20-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8642 \
    DATA_DIR=/data \
    NO_OPEN=1

WORKDIR /app

COPY package.json server.js index.html app.js bookmarklet.js styles.css ./

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8642
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "server.js"]
