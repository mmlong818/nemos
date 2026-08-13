FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./server.mjs
ENV PORT=8799 CLOWNFISH_SYNC_DATA=/home/node/data
RUN mkdir -p /home/node/data && chown -R node:node /home/node/data
EXPOSE 8799
VOLUME ["/home/node/data"]
USER node
CMD ["node", "server.mjs"]
