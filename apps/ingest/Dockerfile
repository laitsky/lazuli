FROM oven/bun:1.3.14-alpine
WORKDIR /app/apps/ingest
ENV NODE_ENV=production \
    PORT=8080

COPY package.json ./package.json
COPY src ./src

USER bun
EXPOSE 8080
CMD ["bun", "run", "src/container/main.ts"]
