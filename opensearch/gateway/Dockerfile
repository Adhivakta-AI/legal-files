FROM node:22-alpine

WORKDIR /app
COPY package.json browse-query.mjs search-query.mjs server.mjs ./

USER node
EXPOSE 7711
CMD ["node", "server.mjs"]
