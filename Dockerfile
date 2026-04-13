FROM node:22-alpine AS base

# ── Dependencies ────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# ── Production Runner ───────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install curl for healthcheck
RUN apk add --no-cache curl

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Use pre-built .next from host (copied from running container)
COPY .next ./.next
COPY --from=deps /app/node_modules ./node_modules
COPY public ./public
COPY package.json ./package.json
COPY next.config.mjs ./next.config.mjs
COPY migrations ./migrations
COPY scripts/entrypoint.sh ./scripts/entrypoint.sh
COPY scripts/push-db.mts ./scripts/push-db.mts
RUN chmod +x ./scripts/entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=512"

ENTRYPOINT ["./scripts/entrypoint.sh"]
CMD ["npx", "next", "start"]
