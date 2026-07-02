FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
