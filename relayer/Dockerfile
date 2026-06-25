# Poof relayer — tiny Node service. Runs tsx directly (no build step needed).
FROM node:22-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm install tsx@^4.19.0
COPY tsconfig.json ./
COPY src ./src

# Railway/Fly inject $PORT; the server reads it (default 8787).
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
