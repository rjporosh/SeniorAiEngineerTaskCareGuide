FROM node:24-alpine AS build
RUN npm i -g pnpm@12.18.0
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @docint/api...
COPY apps/api apps/api
RUN pnpm --filter @docint/api build \
 && pnpm --filter @docint/api deploy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
COPY --from=build /out/node_modules node_modules
COPY --from=build /repo/apps/api/dist dist
COPY --from=build /repo/apps/api/prisma prisma
COPY --from=build /repo/apps/api/prisma.config.ts /repo/apps/api/scripts/migrate.mjs ./
COPY --from=build /repo/apps/api/package.json package.json
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3001/api/v1/health/live || exit 1
CMD ["node", "--import", "./dist/instrumentation.js", "dist/main.js"]
