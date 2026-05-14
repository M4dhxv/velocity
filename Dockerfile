FROM node:22-alpine

# Install Playwright dependencies
RUN apk add --no-cache \
  chromium \
  firefox \
  dbus \
  ttf-liberation \
  font-noto-emoji

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy app code
COPY . .

# Expose for healthcheck (optional)
EXPOSE 3000

# Start autofill worker
CMD ["node", "workers/autofill-processor.js"]
