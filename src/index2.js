const cors = require('cors');
require('dotenv').config();
const { PubSub } = require('apollo-server-express');
const { logger } = require('./log');
const express = require('express');

const {
  createSchema,
  getWatchables,
  deleteDeprecatedWatchPaths,
  deleteWatchParameters,
} = require('./schema');

const utilities = require('./utilities');
const getOpenApiSpec = require('./oas');
const path = require('path');

//------
const ws = require('ws'); // yarn add ws
const wsServer = require('http').createServer();
const WebSocketServer  = require('ws').Server; // yarn add ws
const wss = new WebSocketServer({ server: wsServer });
const { useServer }  = require('graphql-ws/lib/use/ws');
const { createClient } = require('graphql-ws');
const bodyParser = require('body-parser');
var events = require('events').EventEmitter.defaultMaxListeners = 100;;
const Crypto = require('crypto');
var process = require('process')
const pubsub = new PubSub();
const serverCache = require('./cache/serverGenCache');
const { default: cluster } = require('cluster');
//------

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
const inCluster = process.env.IN_CLUSTER !== 'false';
logger.info({ inCluster }, 'cluster mode configured');

let clientInternalWsMap={};
let internalSubObjMap={}
let clientToInternalSubIdMap={};

const app = express();
app.use(cors());
app.use(bodyParser.json());

// GQL QUERIES
app.get('/gql', async(req, res) => {
  if(req?.headers?.connectionparams){
    const queryParams= JSON.parse(req?.headers?.connectionparams);
    const { query, authorization, clusterUrl }= queryParams;
    res.send({
      data : await gqlServerRouter(
        null,
        clusterUrl,
        null,
        null,
        authorization,
        query,
        queryParams,
        requestTypeEnum.query
      ) 
    })
  }
});

const requestTypeEnum={
  subscribe: 'subscribe',
  close: 'close',
  query: 'query'
};

setInterval(() => {
  console.log('Servers', Object.keys(serverCache.servers))
  console.log('internalSubObjMap', internalSubObjMap)
  console.log('clientToInternalSubIdMap', clientToInternalSubIdMap)
  console.log('clientInternalWsMap', clientInternalWsMap)
  console.log('MEM_USAGE', process.memoryUsage().heapTotal/1000000)
  checkServerConnections()
}, 10000) 

// Use this to update server timestamps for last use
// If there are any connected sockets
const checkServerConnections = () => {
  for(let serverName of Object.keys(serverCache?.servers)){
    let socketCount=0;
    serverCache.servers[serverName]?.serverObj?.clients?.forEach((socket) => {
      socketCount++;
    })
    console.log('SERVER---', serverName, socketCount);
  }
}

// Keep track of client -> sub id
// Keep track of Subid -> internal sub obj
const pairSubToClient = (clientId, subObj, internalSubId, clientSubId) => {
  internalSubObjMap[internalSubId]= subObj;
  clientToInternalSubIdMap[clientSubId]= internalSubId;
  if(!clientInternalWsMap[clientId]){
    clientInternalWsMap[clientId]=[internalSubId]
    
  }else{
    newClientData= clientInternalWsMap;
    newClientSubList= newClientData?.[clientId] || [];
    newClientSubList.push(internalSubId);
    newClientData[clientId]= newClientSubList;
    clientInternalWsMap= newClientData;
  }
}

// META WEBSOCKET CONNECTION HANDLER
wss.on('connection', function connection(ws) {
  ws.on('message', function message(data) {
    try {
      const connectionMessage= JSON.parse(data);
      const { requestType, clientId, query, connectionParams }= connectionMessage;

      // SUBSCRIPTION REQUEST
      if(requestType === requestTypeEnum.subscribe){
        ws.clientId= clientId;
        logger.debug('Internal ws subscribe request from', connectionParams.clientId)
        if(
          connectionParams?.clusterUrl&&
          clientId&&
          emitterId&&
          connectionParams?.authorization&&
          query
        ){  
          const emitterId= connectionParams.clientId;
          gqlServerRouter(
            emitterId, 
            connectionParams?.clusterUrl, 
            clientId, 
            ws, 
            connectionParams?.authorization, 
            query,
            connectionParams,
            requestTypeEnum.subscribe
          )
        }else{
          ws.send('error', 'Invalid request')
        }
      }

      // END INTERNAL SOCKET
      else if(requestType === requestTypeEnum.close){
        destroySpeifiedInternalWebsocket(connectionParams.clientSubId, connectionParams.clientId);
      }
    } catch (error) {
      return {
        error: {
          errorPayload: error
        }
      }
    }
  });
  
  // CLIENT DISCONNECT -> END ALL INTERNAL SOCKETS FOR CLIENT
  ws.on('close', () => {
    try {
      // End all internal websockets for disconnected client
      logger.debug('Meta websocket closed for', ws.clientId);
      const currentClientId= ws.clientId;
      destroyCachedDataForClient(currentClientId);
    } catch (error) {
      return {
        error: {
          errorPayload: error
        }
      }
    }
  });
  logger.debug('New meta websocket')
});

// ENDS SPECIFIC INTERNAL SUB FOR CLIENT
const destroySpeifiedInternalWebsocket = (clientSubId, clientId) => {
  logger.debug('Closing internal ws', clientSubId)
  const internalSocketId= clientToInternalSubIdMap[clientSubId];
  const internalSubObj = internalSubObjMap[internalSocketId];
  internalSubObj.dispose();
  delete internalSubObjMap[internalSocketId];
  delete clientToInternalSubIdMap[clientSubId];
  const filteredClientInternalWs= clientInternalWsMap[clientId].filter((intsbid) => intsbid !== internalSocketId);
  clientInternalWsMap[clientId]= filteredClientInternalWs;
}

// ENDS ALL CACHED ROUTING DATA FOR CLIENT
const destroyCachedDataForClient = (wsId) => {
  logger.debug('Internal ws close request from', wsId)
  let internalSubsForClient=[];
  for(let cachedInternalSubId of clientInternalWsMap[wsId]){
    internalSubObjMap[cachedInternalSubId].dispose();
    delete internalSubObjMap[cachedInternalSubId];
    internalSubsForClient.push(cachedInternalSubId);
  };
  delete clientInternalWsMap[wsId];
  let newClientToInternalSubIdMap= {...clientToInternalSubIdMap}
  for(let internalSubClientKey of Object.keys(clientToInternalSubIdMap)){
    if(internalSubsForClient.includes(clientToInternalSubIdMap[internalSubClientKey])){
      delete newClientToInternalSubIdMap[internalSubClientKey]
    }
  }
  clientToInternalSubIdMap= newClientToInternalSubIdMap;
}

// DETERMINES IF NEW GQL SERVER NEEDS GENERATION
const gqlServerRouter = async(
  emitterId, 
  clusterUrl, 
  clientId, 
  ws, 
  token, 
  query, 
  connectionParams,
  requestMode
) => {
  const genServerHandler = async(freePort) => {
    logger.debug('Generating server for', clusterUrl)
    const { serverUrl, serverObj, error }= await generateGqlServer(freePort, clusterUrl, token);
    if(!error){
      serverCache.cacheServer(null, clusterUrl, serverUrl, freePort, serverObj);
      if(requestMode === requestTypeEnum.subscribe){
        const emitter = connectSub(serverUrl, emitterId, clientId, query, connectionParams);
        serverCache.movePortUsed(freePort);
        emitter.on(emitterId, data => {
          ws.send(JSON.stringify(data))
        });
      }else{
        const queryResponse= await connectQuery(serverUrl, query, connectionParams);
        return queryResponse;
      }
      logger.debug('Server generation success', clusterUrl)
    }else {
      logger.debug('Server generation failed....', clusterUrl)
    }
  }

  const gqlServerData= serverCache.getServer(clusterUrl);
  // SERVER FOR CLUSTER EXISTS
  if(gqlServerData){
    const { gqlServerUrl, gqlServerClient }= gqlServerData;
    logger.debug('Found existing server for', clusterUrl);

    // SUBSCRIPTION
    if(requestMode === requestTypeEnum.subscribe){
      const emitter = connectSub(gqlServerUrl, emitterId, clientId, query, connectionParams);
      emitter.on(emitterId, data => {
        ws.send(JSON.stringify(data))
      });
    }

    // QUERY
    else{
      const queryResponse= await connectQuery(gqlServerUrl, query, connectionParams);
      return queryResponse;
    }
  }

  // SERVER DOSENT EXIST -> GENERATE
  else{
    logger.debug('Check if ports are available....', serverCache.portQueue);
    const freePort= serverCache.getPort();

    // FREE PORT -> CREWATE SERVER AT PORT
    if(freePort){
      logger.debug('Port is available', freePort)
      const queryResponse = await genServerHandler(freePort);
      logger.debug('genServerHandler respnse!!!', queryResponse)
      if(requestMode === requestTypeEnum.query){
        return queryResponse;
      }
    }

    // NO FREE PORTS -> RECYCLE SERVER
    else{
      logger.debug('Port is unavailable, recle port')
      await serverCache.recycleServer();
      gqlServerRouter(
        emitterId, 
        clusterUrl, 
        clientId, 
        ws, 
        token, 
        query, 
        connectionParams,
        requestMode
      );
    }
  }
}

// GENERATES CLUSTER SCHEMA FOR NEW SERVERS
const generateClusterSchema = async(kubeApiUrl, schemaToken) => {
  logger.debug('Generating cluster schema', kubeApiUrl)
  const oasRaw = await getOpenApiSpec(kubeApiUrl, schemaToken);
  const oasWatchable = deleteDeprecatedWatchPaths(oasRaw);
  const subs = await getWatchables(oasWatchable);
  const oas = deleteWatchParameters(oasWatchable);
  const graphQlSchemaMap = await utilities.mapGraphQlDefaultPaths(oas);
  if(graphQlSchemaMap.error){
    // proabably an invalid zuth token
    return graphQlSchemaMap;
  }
  const k8PathKeys = Object.keys(oas.paths);
  const mappedK8Paths = utilities.mapK8ApiPaths(
    oas,
    k8PathKeys,
    graphQlSchemaMap
  );
  const schema = await createSchema(
    oas,
    kubeApiUrl,
    mappedK8Paths,
    subs.mappedWatchPath,
    subs.mappedNamespacedPaths
  );
  return schema;
}

// GENERATES NEW GQL SERVER FOR CLUSTER
const generateGqlServer = async(port, kubeApiUrl, schemaToken) => {
  logger.debug('Generating server at port', port)
  const authTokenSplit = schemaToken.split(' ');
  const token = authTokenSplit[authTokenSplit.length - 1];
  const newSchema = await generateClusterSchema(kubeApiUrl, token);
  if(newSchema.error){
    return newSchema;
  }else{
    let wsserver = await new WebSocketServer({
      port: port,
      path: '/gql'
    });
    await useServer({ 
      schema: newSchema, 
      context: ({req, connectionParams }) => {
        const {
          authorization,
          clusterUrl,
          clientId,
          emitterId
        }= connectionParams;
  
        return {
          authorization,
          clusterUrl,
          clientId,
          subId: Date.now().toString(36) + Math.random().toString(36).substr(2),
          emitterId,
          pubsub
        }
      }
    }, wsserver);
    return {
      serverUrl: `ws://localhost:${port}/gql`,
      serverObj: wsserver
    }
  }
}

// CONNECTS CLIENTS WITH INTERNAL QUERY
const connectQuery = async(wsUrl, query, connectionParams) => {
  const client = createClient({
    url: wsUrl,
    webSocketImpl: ws,
    /**
     * Generates a v4 UUID to be used as the ID.
     * Reference: https://gist.github.com/jed/982883
     */
    generateID: () =>
      ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (Crypto.randomBytes(1)[0] & (15 >> (c / 4)))).toString(16),
      ),
      connectionParams
  });
  let wow = await (async () => {
    return result = await new Promise((resolve, reject) => {
      let result
      client.subscribe(
        {
          query: query
        },
        {
          next: (data) => {
            result = data
            console.log('QUERY DATA next', data)
          },
          error: (err) => console.log('QUERY ERROR', err),
          complete: () => resolve(result)
        }
      )
    })
  })()
  return wow;
}

// CONNECTS CLIENTS WITH INTERNAL SUBSCRIPTIONS
const connectSub = (wsUrl, emitterId, clientId, query, connectionParams) => {
  try {
    console.log('CONECTING TO', wsUrl, query);
    const em = new events.EventEmitter();
    const client = createClient({
      url: wsUrl,
      webSocketImpl: ws,
      /**
       * Generates a v4 UUID to be used as the ID.
       * Reference: https://gist.github.com/jed/982883
       */
      generateID: () =>
        ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
          (c ^ (Crypto.randomBytes(1)[0] & (15 >> (c / 4)))).toString(16),
        ),
        connectionParams
    });

    (async () => {
      const onNext = (val) => {
        em.emit(emitterId, val);
      };
      await client.subscribe(
        {
          query: query,
        },
        {
          next: onNext,
          error: (er) => console.log('Subscription error!' ,er),
          complete: (er) => console.log('Subscription complete!'),
        },
      );
      const internalSubId = Date.now().toString(36) + Math.random().toString(36).substr(2);
      pairSubToClient(clientId, client, internalSubId, connectionParams.clientSubId)
    })();
    return em;
  } catch (error) {
    console.log('Connection failed...', error)
  }
}

// BASE SERVER STARTUP
const serverStart = () => {
  let PORT = `${process.env.SERVER_PORT}`;
  if (!process.env.SERVER_PORT) {
    PORT = 8080;
  }
  wsServer.on('request', app);
  wsServer.listen(PORT, () => {
    console.log(`🚀 Ws server Listening on port ${wsServer.address().port}`)
  }) 
};

serverStart();