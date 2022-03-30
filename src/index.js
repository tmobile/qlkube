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
  const token= `Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6ImpTMVhvMU9XRGpfNTJ2YndHTmd2UU8yVnpNYyJ9.eyJhdWQiOiI1YzllODJiNS03NzBiLTQ2NzYtYjZiOC0zNzU5ZDdiNGEwMmIiLCJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjL3YyLjAiLCJpYXQiOjE2NDg1OTY1ODksIm5iZiI6MTY0ODU5NjU4OSwiZXhwIjoxNjQ4NjAwNDg5LCJlbWFpbCI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwiZ3JvdXBzIjpbIkF0ZXJuaXR5IFVzZXJzIiwiTGljZW5zZV9XaW4xMF9SU0FUIEZ1bGwiLCJQR0hOLUlTQS1Mb2FkX0JhbGFuY2VyLVBSRCIsIk1vYmlsZUlyb25fRU5UIiwiUm9sZV9UTVVTX0ZURSIsIkxpY2Vuc2VfTWljcm9zb2Z0IE9mZmljZSAzNjUgeDg2IE9uLURlbWFuZCIsIlNBIE5vdGlmaWNhdGlvbnMiLCJMaWNlbnNlX01pY3Jvc29mdCBBenVyZSBFTVMiLCJBdGVybml0eSBFVFMiLCJSb2xlX1RlY2hub2xvZ3lfQWxsIiwiUmVsaWFuY2VXb3JrTG9nIiwiTGljZW5zZV9NYWtlIE1lIEFkbWluIEVucm9sbG1lbnQiLCJEcnV2YSBVc2VycyBXZXN0IiwiU3BsdW5rVmlld19BbGxVc2VycyIsIk9UX1RlY2hub2xvZ3lfQWxsIiwiRFNHX1dlYmJfRlRFIiwiTGljZW5zZV9EcnV2YSBJblN5bmMiLCJMaWNlbnNlX0RvY2tlciIsIkFwcERpc3RfUlNBVCBGdWxsIiwiQXBwRGlzdF9NaWNyb3NvZnQgT2ZmaWNlIDM2NSB4ODYgT24tRGVtYW5kIiwiSURNX1ZQTl9PS1RBX01GQSIsIkNpdHJpeF9DYXJlX1JlbW90ZUFjY2VzcyIsIlZQTi1OZXR3b3JrLUVJVCIsIk9LVEFfQXBwcmVjaWF0aW9uLVpvbmUiLCJBbGxvdyBXb3Jrc3RhdGlvbiBFbGV2YXRpb24iLCJBcHBkaXN0X0RydXZhIHVzZXJzIGV4Y2x1ZGluZyBFeGVjcyIsIkFwcGRpc3RfSURNX1ZQTl9PS1RBX01GQSIsIlRlY2hub2xvZ3lfUk5FXHUwMDI2T18yIiwiT1RfRlRFIiwiTUlfQXBwc19UTmF0aW9uX1dyYXBwZWQiXSwibmFtZSI6IlV0dGksIERldHJpY2giLCJub25jZSI6IjFlOGMwMmNjLWZiNTgtNDM0YS1hMTZiLTFlYzhmNTYxODA5YiIsIm9pZCI6IjE3ZDkyOWIyLTY5MDYtNDdlMC04Y2E5LTNhYmIzOTcyYmM3YiIsInByZWZlcnJlZF91c2VybmFtZSI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwicmgiOiIwLkFSTUFDNWdQdnBuZEdVdTllN3h4b0pzQ2JMV0NubHdMZDNaR3RyZzNXZGUwb0NzVEFOMC4iLCJzdWIiOiIyUVB5Y3pBa3BQMmh0UlBFcFNZXy1UeUo5WTY2d1o3NlY0NG1sek1aTmJRIiwidGlkIjoiYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjIiwidXRpIjoidGp6ZzM4Z3RxRXFMX1FHLVRVYzVBQSIsInZlciI6IjIuMCIsInNhbWFjY291bnRuYW1lIjoiZHV0dGkxIn0.IaeQcgx_YRE7XGVhYqmXmyMXdJlcjSI3BwwlvnOvFPUG_0BOWp6H1-49vOcKUHpLN4YXk5iMzbHeNsUyWwTySdFL7CKgXLBj9nVtpGdjveDFEyN4O0nYaFZVh94MTqEm4QQdHfHF2_nuSXPTnkBEZJkDLXvrO1LXTGf3mSqNe2nM6_fC9NkFEQLBPb44RHq8HoO-9TOYzH0NX9CcDvQbnVDrXmsJlUzgqCAFsNFRBa1qrgGnX236b6LPEBvIKnvOMkUD8p74hPp1-DZCNQFmdrqfcVRR0gdPz8sNgbXGRF-lMCQQiNypwxpN3wdXiuBZaxfmdrnP_CYQWIM06rn7vA`
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
