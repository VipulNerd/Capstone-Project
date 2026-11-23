# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Build-time configuration (Vite inlines VITE_* variables into the bundle)
ARG VITE_API_BASE_URL=/api
ARG VITE_MAX_CHUNK_MB=25
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_MAX_CHUNK_MB=$VITE_MAX_CHUNK_MB
RUN npm run build

# ---- serve stage ----
FROM nginx:1.27-alpine
# Runtime: where nginx forwards /api (the docker-compose service name by default)
ENV BACKEND_URL=http://backend:8000
# Exports NGINX_LOCAL_RESOLVERS (the DNS server from /etc/resolv.conf) for nginx.conf,
# so the same image works in docker-compose and Azure Container Apps.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
