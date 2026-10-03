# Helix web app. Build from the repository root:
#   docker build -f web/Dockerfile -t helix-web .
FROM node:24-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY web ./
# /docs is rendered from these files
COPY docs /app/docs

# NEXT_PUBLIC_* values are inlined at build time: the URL is the API as the browser reaches it
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_REPOSITORY_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_REPOSITORY_URL=$NEXT_PUBLIC_REPOSITORY_URL
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
