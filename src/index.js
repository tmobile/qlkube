const cors = require('cors');
require('dotenv').config();
const { ApolloServer, PubSub } = require('apollo-server-express');
const { logger } = require('./log');
const express = require('express');
const http = require('http');
const fs = require('fs').promises;
const nodeFs = require('fs');

const {
  createSchema,
  getWatchables,
  deleteDeprecatedWatchPaths,
  deleteWatchParameters,
} = require('./schema');
const utilities = require('./utilities');
const getOpenApiSpec = require('./oas');
const watch = require('./watch');
const path = require('path')

// const { getSchema } = require('./trial2')
// TODO: remove the need for this
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

async function main() {
  const inCluster = process.env.IN_CLUSTER !== 'false';
  logger.info({ inCluster }, 'cluster mode configured');
  let kubeApiUrl;
  let schemaToken;
  if (inCluster) {
    kubeApiUrl = 'https://kubernetes.default.svc';
    schemaToken = await fs.readFile(
      '/var/run/secrets/kubernetes.io/serviceaccount/token',
      'utf8'
    );
  } else if (process.env.KUBE_API_URL && process.env.TOKEN) {
    kubeApiUrl = process.env.KUBE_API_URL;
    schemaToken = process.env.TOKEN;
  } else {
    kubeApiUrl = 'http://localhost:8001';
    schemaToken = '';
  }
  const pubsub = new PubSub();
  const bareContext = { pubsub };

  // const authTokenSplit = schemaToken.split(' ');
  // const token = authTokenSplit[authTokenSplit.length - 1];
  // const oasRaw = await getOpenApiSpec(kubeApiUrl, token);
  // const oasWatchable = deleteDeprecatedWatchPaths(oasRaw);
  // const subs = await getWatchables(oasWatchable);
  // const oas = deleteWatchParameters(oasWatchable);
  // const schema = await createSchema(
  //   oas,
  //   kubeApiUrl,
  //   subs.mappedWatchPath,
  //   subs.mappedNamespacedPaths,
  // ); // takes the longest

  
  // const schema = await getSchema()
  // console.log('schema', schema)
  const token= `Bearer `
  const server = new ApolloServer({
    schema,
    context: async ({ req, connection }) => {
      if (connection) {
        console.log('hmmmmm2', connection.context.clusterUrl, connection.context.clientId)
        return {
          ...bareContext,
          authorization: token,
          clusterUrl: connection.context.clusterUrl,
          clientId: connection.context.clientId,
          subId: await watch.generateSubId(),
        };
      }
      // const token = req.headers.authorization || '';
      const clusterUrl = req.headers.apiserverurl || '';
      if (token === '') {
        throw new Error('Missing authorization header.');
      }
      if (clusterUrl === '') {
        throw new Error('Missing apiserverurl header.');
      }
      return {
        ...req,
        authorization: token,
        clusterUrl,
      };
    },
    subscriptions: {
      path: '/subscriptions',
      onConnect: async (connectionParams, webSocket, context) => {

        // const token = token;
        const clusterUrl = connectionParams.apiserverurl || null;
        const clientId = connectionParams.clientId || null;
        if (!token) {
          throw new Error('Missing authorization header.');
        }
        if (!clusterUrl) {
          throw new Error('Missing apiserverurl header.');
        }
        if (!clientId) {
          throw new Error('Missing clientId header.');
        }
        return {
          ...context,
          authorization: token,
          clusterUrl,
          subId: await watch.generateSubId(),
          clientId
        };
      },
      onDisconnect: (webSocket, context) => {
        logger.info('Client Disconnected', context.request.socket.remoteAddress);
      },
    },
  });

  var PORT = `${process.env.SERVER_PORT}`;
  if (!process.env.SERVER_PORT) {
    PORT = 4000;
  }
  const app = express();
  app.use(cors());
  const versionJSON = nodeFs.readFileSync(path.join(__dirname, '../public/health.json')).toString();
  app.get('/health', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(versionJSON);
  });

  server.applyMiddleware({ app });

  const httpServer = http.createServer(app);
  server.installSubscriptionHandlers(httpServer);

  httpServer.listen(PORT, () => {
    logger.info(
      `🚀 Server ready at http://localhost:${PORT}${server.graphqlPath}`
    );
    logger.info(
      `🚀 Subscriptions ready at ws://localhost:${PORT}${server.subscriptionsPath}`
    );
  });
}

main().catch((e) =>
  logger.error({ error: e.stack }, 'failed to start qlkube server')
);
