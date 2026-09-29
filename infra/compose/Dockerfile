FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS source
RUN npm install --global pnpm@12.6.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json eslint.config.mjs ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/web ./apps/web
COPY scripts ./scripts
COPY infra/compose/test-db.mjs ./infra/compose/test-db.mjs

FROM source AS test
COPY infra/probe/selected-attempt.ts ./infra/probe/selected-attempt.ts
COPY infra/probe/workspace-attempt.ts ./infra/probe/workspace-attempt.ts
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @monos/web build
CMD ["node", "infra/compose/test-db.mjs"]

FROM source AS server
RUN pnpm install --prod --frozen-lockfile
COPY --from=test /app/apps/web/dist ./apps/web/dist
CMD ["node", "--experimental-strip-types", "apps/server/src/main.ts"]
