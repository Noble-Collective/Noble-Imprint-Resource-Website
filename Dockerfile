FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Pre-fetch all content into disk cache so containers start warm.
# The cache survives as a baked layer — no API calls needed on startup.
ARG GITHUB_TOKEN
RUN if [ -n "$GITHUB_TOKEN" ]; then \
      GITHUB_TOKEN=$GITHUB_TOKEN node scripts/warm-cache.js; \
    else \
      echo "No GITHUB_TOKEN — skipping cache warm-up"; \
    fi

EXPOSE 8080
ENV NODE_ENV=production
ARG BUILD_TIME
ENV BUILD_TIME=${BUILD_TIME}
CMD ["node", "src/server/index.js"]
