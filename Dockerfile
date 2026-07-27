# Pull the base image from Google's Docker Hub mirror instead of docker.io.
# The mirror lives on the same network as the GCR push / Cloud Run deploy, so it
# avoids the intermittent "dial tcp registry-1.docker.io i/o timeout" that failed
# the nightly build (it falls through to Docker Hub if a tag isn't cached).
FROM mirror.gcr.io/library/node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
ENV NODE_ENV=production
ARG BUILD_TIME
ENV BUILD_TIME=${BUILD_TIME}
CMD ["node", "src/server/index.js"]
