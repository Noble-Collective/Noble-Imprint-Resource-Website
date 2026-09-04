# Pull the base image from Google's Docker Hub mirror instead of docker.io.
# The mirror lives on the same network as the GCR push / Cloud Run deploy, so it
# avoids the intermittent "dial tcp registry-1.docker.io i/o timeout" that failed
# the nightly build (it falls through to Docker Hub if a tag isn't cached).
FROM mirror.gcr.io/library/node:22-slim
WORKDIR /app
COPY package*.json ./
# vendor/ holds the committed @noble-collective/userdata tarball referenced as a file: devDependency.
# Copy it before `npm ci` so lockfile resolution never hits a missing path (it's dev-only, so
# --omit=dev skips installing it, but the file must exist for ci to validate the tree).
COPY vendor ./vendor
RUN npm ci --omit=dev
COPY . .
# Run as the unprivileged built-in `node` user (was root). chown so the app can still
# write its runtime disk caches (.file-cache/.bible-cache/.content-tree-cache.json).
RUN chown -R node:node /app
USER node
EXPOSE 8080
ENV NODE_ENV=production
ARG BUILD_TIME
ENV BUILD_TIME=${BUILD_TIME}
CMD ["node", "src/server/index.js"]
