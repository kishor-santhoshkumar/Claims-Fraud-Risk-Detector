# ── Frontend image (Railway frontend service) ─────────────────────────────────
# Build context: frontend/ directory (set Root Directory = frontend in Railway)
#
# VITE_API_URL must be passed at build time — it is baked into the JS bundle.
# Set it to your Railway backend's public URL with /api suffix:
#   https://your-backend.up.railway.app/api
#
# Build:   docker build --build-arg VITE_API_URL=https://... -t fraud-frontend .
# Run:     docker run -e PORT=3000 -p 3000:3000 fraud-frontend

# ── Stage 1: build the React/Vite app ────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install deps first (cached layer)
COPY package*.json ./
RUN npm ci --silent

# Accept the backend URL as a build argument
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN npm run build

# ── Stage 2: serve static output ─────────────────────────────────────────────
FROM node:20-slim

RUN npm install -g serve@14

WORKDIR /app
COPY --from=builder /app/dist ./dist

# Railway injects $PORT; default to 3000 for local docker run.
EXPOSE 3000
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
