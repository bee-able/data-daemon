FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --production=false
COPY tsconfig.json ./
COPY nest-cli.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
