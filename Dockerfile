FROM node:22-bookworm-slim
WORKDIR /app
RUN npm init -y && npm install --omit=dev --ignore-scripts --no-audit --no-fund --save-exact ajv@8.17.1 @xmldom/xmldom@0.8.11
# The phone UI and all server contracts must ship from the same checkout.
COPY assets/ ./assets/
COPY server/ ./server/
COPY content/ ./content/
ENV SELENE_BIND=0.0.0.0
EXPOSE 4519
CMD ["node", "server/index.mjs"]
