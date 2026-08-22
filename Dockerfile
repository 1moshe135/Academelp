FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js index.html app.js bookmarklet.js styles.css ./

ENV HOST=0.0.0.0 \
    PORT=8642 \
    NO_OPEN=1

RUN addgroup -S academelp && adduser -S academelp -G academelp \
    && touch /app/data.json && chown academelp:academelp /app/data.json
USER academelp

EXPOSE 8642

VOLUME ["/app/data.json"]

CMD ["node", "server.js"]
