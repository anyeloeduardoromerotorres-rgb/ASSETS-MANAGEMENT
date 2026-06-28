FROM node:22-alpine AS build

WORKDIR /app

ARG EXPO_PUBLIC_API_URL=https://hbsjajakwksnsj.duckdns.org/api
ARG EXPO_PUBLIC_SHOW_DEBUG_TOOLS=false
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_SHOW_DEBUG_TOOLS=$EXPO_PUBLIC_SHOW_DEBUG_TOOLS

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:web

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
