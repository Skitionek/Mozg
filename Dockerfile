# Mozg — production image.
#   docker build -t mozg .
#   docker run -p 4000:4000 mozg
# Node 26, the active LTS line, on Debian 13 (trixie): sqlite3's prebuilt
# binding needs glibc 2.38, which Debian 12 (glibc 2.36) lacks.  CI builds it
# on every Node line in .github/ci-presets.json with --build-arg NODE_TAG
# (a tag of the official node image, so the base stays that image).
ARG NODE_TAG=26-trixie-slim

FROM node:${NODE_TAG} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:${NODE_TAG}
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY examples/queries.json examples/blog.ttl ./examples/
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
