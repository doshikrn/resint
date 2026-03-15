# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
# Pass real values via docker-compose build.args (see docker-compose.prod.yml).
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_KITCHEN_WAREHOUSE_ID
ARG NEXT_PUBLIC_BAR_WAREHOUSE_ID
ARG NEXT_PUBLIC_BRAND_NAME
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
ENV NEXT_PUBLIC_KITCHEN_WAREHOUSE_ID=$NEXT_PUBLIC_KITCHEN_WAREHOUSE_ID
ENV NEXT_PUBLIC_BAR_WAREHOUSE_ID=$NEXT_PUBLIC_BAR_WAREHOUSE_ID
ENV NEXT_PUBLIC_BRAND_NAME=$NEXT_PUBLIC_BRAND_NAME
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
