FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV BACKGROUND_JOBS_ENABLED=true

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY src ./src

EXPOSE 3000
CMD ["npm", "start"]
