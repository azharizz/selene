FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium chromium-sandbox ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && npm init -y && npm install --omit=dev --ignore-scripts --no-audit --no-fund --save-exact ajv@8.17.1 @xmldom/xmldom@0.8.11 puppeteer-core@24.40.0 onnxruntime-node@1.30.0
# The phone UI and all server contracts must ship from the same checkout.
COPY --chown=node:node assets/ ./assets/
COPY server/ ./server/
COPY shared/ ./shared/
COPY scripts/ingest-video.mjs ./scripts/ingest-video.mjs
COPY scripts/remote-media.mjs ./scripts/remote-media.mjs
COPY --chown=node:node content/ ./content/
ENV SELENE_BIND=0.0.0.0 SELENE_CHROMIUM_PATH=/usr/bin/chromium
USER node
EXPOSE 4519
CMD ["node", "server/index.mjs"]
