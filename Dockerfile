# syntax=docker/dockerfile:1

# Base images use an explicit tag plus digest so the same Dockerfile reproduces the same
# layers until you deliberately bump versions. Digests were resolved on 2026-04-20.
#
# To upgrade: pick new tags on Docker Hub, run:
#   docker buildx imagetools inspect node:<tag> --format '{{json .Manifest.Digest}}'
#   docker buildx imagetools inspect nginx:<tag> --format '{{json .Manifest.Digest}}'
# and update the FROM lines below.

FROM node:22.15.1-bookworm@sha256:e558507eb799e3a76fcdaaee5e48dce1a00aebc85892128a9fca59f63bd49511 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./

# Vite inlines `VITE_*` variables at build time (see `.env.example`).
ARG VITE_FEED_BASE_URL=https://feed.feralfile.com
ARG VITE_WALLETCONNECT_PROJECT_ID=
ENV VITE_FEED_BASE_URL=${VITE_FEED_BASE_URL}
ENV VITE_WALLETCONNECT_PROJECT_ID=${VITE_WALLETCONNECT_PROJECT_ID}

RUN npm run build

FROM nginx:1.27.5-alpine3.21-slim@sha256:b947b2630c97622793113555e13332eec85bdc7a0ac6ab697159af78942bb856 AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
