const express = require('express');
const server = require('http').createServer();
const bodyParser = require('body-parser');
const cors = require('cors');
const k8s = require('@kubernetes/client-node');
const { PubSub } = require('apollo-server-express');
const WebSocketServer = require('ws').Server; // yarn add ws
const { useServer } = require('graphql-ws/lib/use/ws');
const { connectQuery } = require('./internalServerConnect');
const { printColor } = require('./consoleColorLogger');

const app = express();
app.use(bodyParser.json());
app.use(cors());

/**
* check wheter or not user can access servers introspection
* @return error object: { error : '...' } or boolean: true 
*/
const checkIntrospection = async (query, authToken) => {
  try {
    const isIntrospection = query.includes('IntrospectionQuery')
    if (!isIntrospection) return true;

    const authTokenSplit = authToken.split(' ');
    const token = authTokenSplit[authTokenSplit.length - 1];

    const kc = new k8s.KubeConfig();
    kc.loadFromOptions({
      clusters: [{ server: process.env.clusterUrl }],
      users: [{ token: token }],
      contexts: [{ name: null, namespace: null }],
      currentContext: null,
    });
    const k8sApi = kc.makeApiClient(k8s.AuthorizationV1Api);
    const accessReviewRes = await k8sApi.createSelfSubjectAccessReview({
      apiVersion: 'authorization.k8s.io/v1',
      kind: 'SelfSubjectAccessReview',
      spec: {
        nonResourceAttributes: {
          path: '/openapi/v2',
          verb: 'get'
        },
      }
    });
    const { status: { allowed } } = accessReviewRes.response.body;
    return allowed ? true : { error: 'user does not have access to introspection' };
  } catch (_error) {
    return { error: _error };
  }
}

/**
* main get request for http server
* @return grqphql query data
*/
app.get('/gqlreq', async(req, res) => {

  if(!req.headers?.connectionparams) res.send({error: 'invalid headers'});

  const { connectionparams } = req.headers;
  const parsedParams = JSON.parse(connectionparams);
  const internalGqlUrl = `ws://127.0.0.1:8080/gql`;
  console.log(parsedParams)
  const httpQueryRes = await connectQuery(
    internalGqlUrl,
    parsedParams
  )
  res.send(httpQueryRes)
});
server.on('request', app);

/**
* generates graphql server
* @return server metadata
*/
const generateServer = async (port, schema) => {

  if (!schema || !port) {
    return {
      error: {
        errorPayload: 'invalid server gen arguments'
      }
    };
  } else {

    let wsserver = await new WebSocketServer({
      server: server,
      path: '/gql'
    });

    server.listen(port, function() {
      printColor('blue', `Server ws/http started at port ${port}`);
    });

    await useServer({
      schema: schema,
      context: async (req, connectionParams) => {
        const {
          authorization,
          clientId,
          emitterId,
          query
        } = connectionParams?.payload;
        const introspectionCheckRes = await checkIntrospection(query, authorization);
        
        if (introspectionCheckRes?.error) throw new Error('user cannot access introspection');

        const pubsub = new PubSub();
        return {
          authorization,
          clusterUrl : process.env.clusterUrl,
          clientId,
          subId: Date.now().toString(36) + Math.random().toString(36).substr(2),
          emitterId,
          pubsub
        }
      }
    }, wsserver);
    const serverUrl = `http://localhost:${port}/gql`;
    return {
      server: wsserver,
      serverUrl: serverUrl,
      port
    };
  }
}

exports.generateServer = generateServer;
