FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
ENV NODE_ENV=production
ARG BUILD_TIME
ENV BUILD_TIME=${BUILD_TIME}
CMD ["node", "src/server/index.js"]
