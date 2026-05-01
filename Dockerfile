# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src/ src/
COPY public/ public/

ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/index.js"]
