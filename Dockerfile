FROM node:14-alpine

ARG SSH_KEY

RUN apk add git openssh-client
COPY . .
RUN mkdir -p -m 0600 ~/.ssh && ssh-keyscan gitlab.com >> ~/.ssh/known_hosts
RUN ssh-agent sh -c 'echo $SSH_KEY | base64 -d | ssh-add - ; npm install --unsafe-perm'

RUN npm install --unsafe-perm
COPY . .

ENV SERVER_PORT=4000
EXPOSE $SERVER_PORT

ENTRYPOINT [ "npm", "start" ]

