FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
USER node
ENV NODE_ENV=production
EXPOSE 9000 9001
CMD ["node", "server.js"]
