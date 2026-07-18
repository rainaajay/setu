FROM node:24-alpine
WORKDIR /app
COPY src ./src
COPY committee-prod.json ./committee-prod.json
ENV SETU_COMMITTEE=/app/committee-prod.json \
    HOST=0.0.0.0 \
    PORT=8080 \
    SETU_STATE_DIR=/tmp/setu-state
EXPOSE 8080
CMD ["node", "src/authority-server.ts"]
