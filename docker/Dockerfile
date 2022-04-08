FROM docker.io/node:17-alpine3.14
WORKDIR /usr/src/app/
RUN apk add --no-cache tini
COPY . .
RUN npm install
RUN npx tsc
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/app.js"]
