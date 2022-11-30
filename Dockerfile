# FROM node:16-alpine

# ARG SSH_KEY 

# RUN apk add git openssh-client
# COPY . .
# RUN mkdir -p -m 0600 ~/.ssh && ssh-keyscan gitlab.com >> ~/.ssh/known_hosts
# RUN ssh-agent sh -c 'echo $SSH_KEY | base64 -d | ssh-add - ; npm install --legacy-peer-deps --unsafe-perm'

# ENV SERVER_PORT=4000
# EXPOSE $SERVER_PORT

# ENTRYPOINT [ "npm", "start" ]

FROM node:16-alpine
ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production

COPY . .

EXPOSE 8080

CMD [ "npm", "start" ]

