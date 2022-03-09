const cors = require('cors');
require('dotenv').config();
const { PubSub } = require('apollo-server-express');
const { logger } = require('./log');
const express = require('express');
const cache = require('./cache/serverObjCache')();
const blocked = require('blocked-at')

const { introspectSchema, wrapSchema } = require('@graphql-tools/wrap')
const { loadSchema } = require('@graphql-tools/load')
const { UrlLoader } = require('@graphql-tools/url-loader')

const {
  createSchema,
  getWatchables,
  deleteDeprecatedWatchPaths,
  deleteWatchParameters,
  testHydateSubscriptions
} = require('./schema');
const {
  Worker, isMainThread, parentPort, workerData
} = require('worker_threads');

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
var events = require('events');
const Crypto = require('crypto');
var process = require('process')
const pubsub = new PubSub();
const serverCache = require('./cache/serverGenCache');
const { default: cluster } = require('cluster');

const serverGen = require('./serverGen');
const SwaggerParser = require("@apidevtools/swagger-parser");

//------

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
const inCluster = process.env.IN_CLUSTER !== 'false';
logger.info({ inCluster }, 'cluster mode configured');

let clientInternalWsMap={};
let internalSubObjMap={}
let clientToInternalSubIdMap={};
let rougeSocketMap={};

const INTRNL_SOCKET_END_TIMEOUT= 120000;
const app = express();
app.use(cors());
app.use(bodyParser.json());
const {
  printSchema,
  buildSchema,
  buildClientSchema,
  printIntrospectionSchema,
  introspectionFromSchema,
} = require('graphql');
let currentGeneratingServers= {};
let connectQueue= {};

// Print servers and their sockets
// app.get('/stats', async(req, res) => {
//   checkServerConnections();
// });

// GQL QUERIES
app.get('/gql', async(req, res) => {
  const { requesttype }= req?.headers;
  if(req?.headers?.connectionparams){
    const queryParams= JSON.parse(req?.headers?.connectionparams);
    const { query, authorization, clusterUrl }= queryParams;
    if(requesttype === 'query_ping'){
      console.log('query_ping')
      const serverStatus= await gqlServerRouter(
        null,
        clusterUrl,
        null,
        null,
        authorization,
        query,
        queryParams,
        requestTypeEnum.query_ping
      ) 
      console.log('query_ping',serverStatus)
      
      res.send({
        data: {
          status: serverStatus
        }
      })
    }else if(requesttype === 'query'){

      const queryResponse= await gqlServerRouter(
        null,
        clusterUrl,
        null,
        null,
        authorization,
        query,
        queryParams,
        requestTypeEnum.query
      ) 
      res.send({
        ...queryResponse
      })
    }
  }

});

const requestTypeEnum={
  subscribe: 'subscribe',
  close: 'close',
  query: 'query',
  query_ping: 'query_ping'
};

setInterval(() => {
  // console.log(' ')
  // console.log(' ')
  // console.log(' ')

  // console.log('Servers', Object.keys(serverCache.servers))
  // // console.log('Servers', serverCache.servers)
  // console.log('internalSubObjMap', internalSubObjMap)
  // console.log('clientToInternalSubIdMap', clientToInternalSubIdMap)
  // console.log('clientInternalWsMap', clientInternalWsMap)
  // console.log('portQueue', serverCache.portQueue)
  // console.log('MEM_USAGE', process.memoryUsage().heapTotal/1000000)
  // checkServerConnections()
}, 5000) 



// ## recycle logic 
// ## 1: servers without sockets and latest time
// ## 2: servers without sockets
// ## if neither, send error?
// ------------------------------------------------------
// Use this to update server timestamps for last use
// If there are any connected sockets
const checkServerConnections = () => {
  for(let clusterUrl of Object.keys(serverCache?.servers)){
    let socketCount=0;
    serverCache.servers[clusterUrl]?.serverObj?.clients?.forEach((socket) => {
      socketCount++;
    });
    if(socketCount > 0){
      serverCache.refreshServerUsage(clusterUrl)
    }
    console.log('SERVER---', clusterUrl, socketCount);
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
  ws.addEventListener('error', (err) => console.log(err.message));

  ws.on('message', function message(data) {
    try {
      const connectionMessage= JSON.parse(data);
      const { requestType, clientId, query, connectionParams }= connectionMessage;
      // console.log('Recieve Message For', clientId)

      // SUBSCRIPTION REQUEST
      if(requestType === requestTypeEnum.subscribe){
        ws.clientId= clientId;
        // logger.debug('Internal ws subscribe request from', connectionParams.clientId);

        if(
          connectionParams?.clusterUrl&&
          clientId&&
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
      logger.error('Ws handler error', error)
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

  ws.on('error', (err) => {
    console.log('ws error ' + err )

  })

  ws.onclose = function(evt){
    console.log('ws error ' + evt )

  }

  logger.debug('New meta websocket', )
});

// ENDS SPECIFIC INTERNAL SUB FOR CLIENT
const destroySpeifiedInternalWebsocket = (clientSubId, clientId) => {
  try {
    setTimeout(() => {
      console.log('Closing internal ws', clientSubId)

      const internalSocketId= clientToInternalSubIdMap[clientSubId];
      const internalSubObj = internalSubObjMap[internalSocketId];
      if(internalSubObj){
        internalSubObj?.dispose();
        delete internalSubObjMap[internalSocketId];
        delete clientToInternalSubIdMap[clientSubId];
        const filteredClientInternalWs= clientInternalWsMap[clientId].filter((intsbid) => intsbid !== internalSocketId);
        clientInternalWsMap[clientId]= filteredClientInternalWs;
      }

    }, INTRNL_SOCKET_END_TIMEOUT)

  } catch (error) {
    console.log('destroySpeifiedInternalWebsocket ' + error )
  }

}

// ENDS ALL CACHED ROUTING DATA FOR CLIENT
const destroyCachedDataForClient = (wsId) => {
  try {
    setTimeout(() => {
      logger.debug('Internal ws close request from', wsId)
      let internalSubsForClient=[];
      if(wsId&&!clientInternalWsMap?.[wsId]?.length > 0){
        for(let cachedInternalSubId of clientInternalWsMap[wsId]){
          internalSubObjMap[cachedInternalSubId].dispose();
          delete internalSubObjMap[cachedInternalSubId];
          internalSubsForClient.push(cachedInternalSubId);
        };
        delete clientInternalWsMap[wsId];
      }

      let newClientToInternalSubIdMap= {...clientToInternalSubIdMap}
      for(let internalSubClientKey of Object.keys(clientToInternalSubIdMap)){
        if(internalSubsForClient.includes(clientToInternalSubIdMap[internalSubClientKey])){
          delete newClientToInternalSubIdMap[internalSubClientKey]
        }
      }
      clientToInternalSubIdMap= newClientToInternalSubIdMap;
    }, INTRNL_SOCKET_END_TIMEOUT)

  } catch (error) {
    console.log('destroyCachedDataForClient ' + error )

  }

}

// ROUTES ALL TRAFFIC, DETERMINES IF NEW GQL SERVER NEEDS GENERATION
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
  try {
    const genServerHandler = async(freePort) => {
      // logger.debug('Generating server for', clusterUrl)
      // const { serverUrl, serverObj, error }= await generateGqlServer(freePort, clusterUrl, token);
      generateGqlServer(freePort, clusterUrl, token).then(async({serverUrl, serverObj, error}) => {
        console.log('Server Gen return!', connectionParams.clientSubId)
        if(!error){
          serverCache.cacheServer(null, clusterUrl, serverUrl, freePort, serverObj);
          serverCache.movePortUsed(freePort);
    
          if(requestMode === requestTypeEnum.subscribe){
            console.log('does sub exist?', )
            console.log('COnnecting sub for', connectionParams.clientSubId);
            sendServerGenerationMessage(ws, 'end-generate')
            setupSub(serverUrl, emitterId, clientId, query, connectionParams, ws)
          }else if (requestMode === requestTypeEnum.query){
            const queryResponse= await connectQuery(serverUrl, query, connectionParams);
            return queryResponse;
          }
          logger.debug('Server generation success', clusterUrl)
        }else {
          logger.debug('Server generation failed....', clusterUrl)
        }
      })

    }
  
    const gqlServerData= serverCache.getServer(clusterUrl);
    // SERVER FOR CLUSTER EXISTS -> CONNECT
    if(gqlServerData){
      const { gqlServerUrl, gqlServerClient }= gqlServerData;
      logger.debug('Found existing server for', clusterUrl);
  
      // SERVER EXISTS -> SUBSCRIPTION
      if(requestMode === requestTypeEnum.subscribe){
        setupSub(gqlServerUrl, emitterId, clientId, query, connectionParams, ws)
      }
  
      // SERVER EXISTS -> QUERY
      else if(requestMode === requestTypeEnum.query){
        const queryResponse= await connectQuery(gqlServerUrl, query, connectionParams);
        serverCache.refreshServerUsage(clusterUrl)
        return queryResponse;
      }
  
      else if(requestMode === requestTypeEnum.query_ping){
        return 'exists';
      }
    }
  
    // SERVER DOSENT EXIST -> GENERATE
    else{
      sendServerGenerationMessage(ws, 'start-generate')
      const freePort= serverCache.getPort();
  
      //IF SERVER IS ALREADY BENING GENERATED
      if(currentGeneratingServers[clusterUrl]){
        if(requestMode === requestTypeEnum.query_ping){
          return 'generating';
        }
        if(requestMode === requestTypeEnum.query){
          const response = await handleQueryWait(clusterUrl, query, connectionParams);
          // console.log('query reppppp???', response);
          return response;
        }
        // console.log('Server is being created', connectionParams.clientSubId)
        connectQueue[clusterUrl] ? 
        connectQueue[clusterUrl].push(
          {
            clusterUrl: connectionParams.clusterUrl, 
            emitterId, 
            clientId, 
            query, 
            connectionParams,
            ws
          }
        ) :
        connectQueue[clusterUrl]= 
        [
          {
            clusterUrl: connectionParams.clusterUrl, 
            emitterId, 
            clientId, 
            query, 
            connectionParams,
            ws
          }
        ]
        // console.log('connectQueue[clusterUrl]', connectQueue[clusterUrl]?.length)
        return;
      }
  
      // FREE PORT -> CREATE SERVER AT PORT
      if(freePort){
        console.log('GENERATE SERVER!', connectionParams.clientSubId)
        // for req query ping, ask for server and leave
        if(requestMode === requestTypeEnum.query_ping){
          genServerHandler(freePort);
          return 'generating';
        }
        sendServerGenerationMessage(ws, 'start-generate')
  
        const queryResponse = await genServerHandler(freePort);
        if(requestMode === requestTypeEnum.query){
          return queryResponse;
        }
      }
  
      // NO FREE PORTS -> RECYCLE SERVER
      else{
        await serverCache.recycleServer();
        return await gqlServerRouter(
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
  } catch (error) {
    console.log('gqlServerRouter', error)

  }

}

const handleQueryWait = async(clusterUrl, query, connectionParams) => {
  return new Promise(async function (resolve) {
    let hasNext=false;

    const interval = setInterval(async() => {
      if(!currentGeneratingServers?.[clusterUrl]&&!hasNext){
        hasNext=true
        clearInterval(interval);
        const { gqlServerUrl } = serverCache.getServer(clusterUrl)
        const queryResponse= await connectQuery(gqlServerUrl, query, connectionParams);
        console.log('queryResponse', queryResponse)
        resolve(queryResponse);
      }
    }, 2000);
  })
}

// SENDS SERVER GENERATION STATUS MESSAGES TO AFFECTED CLIENTS
const sendServerGenerationMessage = (focusedWs, messageType) => {
  // console.log('sendServerGenerationMessage', messageType)
  if(focusedWs?.readyState !== 1)
    return;

  messageType === 'start-generate'&&focusedWs?.send(JSON.stringify(
    {
      status: 'generating'
    }
  ))
  messageType === 'end-generate'&&focusedWs?.send(JSON.stringify(
    {
      status: 'exists'
    }
  ))
}

// SETS UP SUBSCRIPTION FOR CLIENT
const setupSub = (gqlServerUrl, emitterId, clientId, query, connectionParams, ws) => {
  try {
    const emitter = connectSub(gqlServerUrl, emitterId, clientId, query, connectionParams);
    emitter.on(emitterId, data => {
      if(ws?.readyState !== 1)
        return;

      ws?.send(JSON.stringify(data))
    });
  } catch (error) {
    console.log('Emit Error', error)
  }

}

// CONNECTS SOCKETS THAT ARE WAITING ON GQL SERVER TO BE GENERATED
const connectWaitingSockets = (clusterUrl, serverUrl) => {
  if(connectQueue[clusterUrl]){
    for(let connectionData of connectQueue[clusterUrl]){
      const { emitterId, clientId, query, connectionParams, ws} = connectionData;
      console.log('connectWaitingSockets',connectionParams.clientSubId);
      sendServerGenerationMessage(ws, 'end-generate')
      setupSub(serverUrl, emitterId, clientId, query, connectionParams, ws);

    }
    delete connectQueue[clusterUrl]
  }
}

// GENERATES CLUSTER SCHEMA FOR NEW SERVERS
const generateClusterSchema = async(kubeApiUrl, schemaToken, finalOas) => {
  logger.debug('Generating cluster schema', kubeApiUrl)
  const oasRaw = await getOpenApiSpec(kubeApiUrl, schemaToken);
  // console.log('Generate Schema 1', oasRaw)
  // let api = await SwaggerParser.dereference(oasRaw);
  // let stringified = JSON.stringify(api)
  console.log('Generate Schema 1')

  // console.log('Generate Schema 1', api)
  const oasWatchable = deleteDeprecatedWatchPaths(oasRaw);
  console.log('Generate Schema 2')
  const subs = await getWatchables(oasWatchable);
  console.log('Generate Schema 3')
  const oas = deleteWatchParameters(oasWatchable);
  // console.log('Generate Schema 4')
  const graphQlSchemaMap = await utilities.mapGraphQlDefaultPaths(oas);// takes a while
  // console.log('Generate Schema 5');
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
  console.log('Generate Schema 6')

  const schema = await createSchema(
    oas,
    kubeApiUrl,
    mappedK8Paths,
    subs.mappedWatchPath,
    subs.mappedNamespacedPaths
  ); // takes the longest
  console.log('Generate Schema 7')
  return schema;
}

// // GENERATES NEW GQL SERVER FOR SPECIFIC CLUSTER
// const generateGqlServer = async(port, kubeApiUrl, schemaToken) => {
//   console.log('GEN NEW SERVER----', port);
//   return new Promise(async(resolve, reject) => {
//     currentGeneratingServers[kubeApiUrl]= true
//     const authTokenSplit = schemaToken.split(' ');
//     const token = authTokenSplit[authTokenSplit.length - 1];
//     const newSchema = await generateClusterSchema(kubeApiUrl, token);
//     if(newSchema.error){
//       // logger.debug('generateGqlServer error....')
//       delete currentGeneratingServers[kubeApiUrl]
//       return newSchema;
//     }else{
//       let wsserver = await new WebSocketServer({
//         port: port,
//         path: '/gql'
//       });
//       await useServer({ 
//         schema: newSchema, 
//         context: ({req, connectionParams }) => {
//           const {
//             authorization,
//             clusterUrl,
//             clientId,
//             emitterId
//           }= connectionParams;
    
//           return {
//             authorization,
//             clusterUrl,
//             clientId,
//             subId: Date.now().toString(36) + Math.random().toString(36).substr(2),
//             emitterId,
//             pubsub
//           }
//         }
//       }, wsserver);
//       console.log('GEN NEW SERVER COMPLETE++++++', port);

//       delete currentGeneratingServers[kubeApiUrl];
  
//       // server gen is complete -> connect waiting sockets
//       connectWaitingSockets(kubeApiUrl,  `ws://localhost:${port}/gql`);
//       resolve ({
//         serverUrl: `ws://localhost:${port}/gql`,
//         serverObj: wsserver
//       })
//     }
//   })

// }

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
    // console.log('CONECTING TO', wsUrl, query);
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
        // console.log('recieved', val)
        em.emit(emitterId, val);
      };
      await client.subscribe(
        {
          query: query,
        },
        {
          next: onNext,
          error: (er) => console.log('Subscription error!' ,er),
          complete: (er) => console.log('Subscription complete!', connectionParams.clientSubId),
          onclose: () => console.log('onclose '),
          
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
    console.log(`🚀🚀🚀 Ws server Listening on port ${wsServer.address().port}`)
  }) 
};

//https://east.npe.duck.master.kube.t-mobile.com:6443
// kubeApiUrl: 'https://west.dev.duck.master.kube.t-mobile.com:6443',


const generateGqlServer2 = async(port=1111, schema) => {
  // console.log('GEN NEW SERVER----', port);
  return new Promise(async(resolve, reject) => {
    // currentGeneratingServers[kubeApiUrl]= true
    // const authTokenSplit = schemaToken.split(' ');
    // const token = authTokenSplit[authTokenSplit.length - 1];
    // const newSchema = await generateClusterSchema(kubeApiUrl, token);
    if(!schema){
      // delete currentGeneratingServers[kubeApiUrl]
      // ## Ping main thread -> error
      return schema;
    }else{
      let wsserver = await new WebSocketServer({
        port: port,
        path: '/gql'
      });
      await useServer({ 
        schema: schema, 
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
      console.log('GEN NEW SERVER COMPLETE++++++111111', port);

      // ## PING MAIN THREAD -> complete
      // delete currentGeneratingServers[kubeApiUrl];
      // server gen is complete -> connect waiting sockets
      // connectWaitingSockets(kubeApiUrl,  `ws://localhost:${port}/gql`);
      // resolve ({
      //   serverUrl: `ws://localhost:${port}/gql`,
      //   serverObj: wsserver
      // })
      // parentPort.postMessage({
      //   serverUrl: `ws://localhost:${port}/gql`,
      //   serverObj: wsserver
      // });

    }
  })

}
const _token= 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik1yNS1BVWliZkJpaTdOZDFqQmViYXhib1hXMCJ9.eyJhdWQiOiI1YzllODJiNS03NzBiLTQ2NzYtYjZiOC0zNzU5ZDdiNGEwMmIiLCJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjL3YyLjAiLCJpYXQiOjE2NDY0MTI0MDMsIm5iZiI6MTY0NjQxMjQwMywiZXhwIjoxNjQ2NDE2MzAzLCJlbWFpbCI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwiZ3JvdXBzIjpbIkF0ZXJuaXR5IFVzZXJzIiwiTGljZW5zZV9XaW4xMF9SU0FUIEZ1bGwiLCJQR0hOLUlTQS1Mb2FkX0JhbGFuY2VyLVBSRCIsIk1vYmlsZUlyb25fRU5UIiwiUm9sZV9UTVVTX0ZURSIsIkxpY2Vuc2VfTWljcm9zb2Z0IE9mZmljZSAzNjUgeDg2IE9uLURlbWFuZCIsIlNBIE5vdGlmaWNhdGlvbnMiLCJMaWNlbnNlX01pY3Jvc29mdCBBenVyZSBFTVMiLCJBdGVybml0eSBFVFMiLCJSb2xlX1RlY2hub2xvZ3lfQWxsIiwiUmVsaWFuY2VXb3JrTG9nIiwiTGljZW5zZV9NYWtlIE1lIEFkbWluIEVucm9sbG1lbnQiLCJEcnV2YSBVc2VycyBXZXN0IiwiU3BsdW5rVmlld19BbGxVc2VycyIsIk9UX1RlY2hub2xvZ3lfQWxsIiwiRFNHX1dlYmJfRlRFIiwiTGljZW5zZV9EcnV2YSBJblN5bmMiLCJMaWNlbnNlX0RvY2tlciIsIkFwcERpc3RfUlNBVCBGdWxsIiwiQXBwRGlzdF9NaWNyb3NvZnQgT2ZmaWNlIDM2NSB4ODYgT24tRGVtYW5kIiwiSURNX1ZQTl9PS1RBX01GQSIsIkNpdHJpeF9DYXJlX1JlbW90ZUFjY2VzcyIsIlZQTi1OZXR3b3JrLUVJVCIsIk9LVEFfQXBwcmVjaWF0aW9uLVpvbmUiLCJBbGxvdyBXb3Jrc3RhdGlvbiBFbGV2YXRpb24iLCJBcHBkaXN0X0RydXZhIHVzZXJzIGV4Y2x1ZGluZyBFeGVjcyIsIkFwcGRpc3RfSURNX1ZQTl9PS1RBX01GQSIsIlRlY2hub2xvZ3lfUk5FXHUwMDI2T18yIiwiT1RfRlRFIiwiTUlfQXBwc19UTmF0aW9uX1dyYXBwZWQiXSwibmFtZSI6IlV0dGksIERldHJpY2giLCJub25jZSI6IjU1OGRjNjJmLTMzM2ItNDE0Ny05NDhhLTg0ZjBhMWQ3ZWZkNSIsIm9pZCI6IjE3ZDkyOWIyLTY5MDYtNDdlMC04Y2E5LTNhYmIzOTcyYmM3YiIsInByZWZlcnJlZF91c2VybmFtZSI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwicmgiOiIwLkFSTUFDNWdQdnBuZEdVdTllN3h4b0pzQ2JMV0NubHdMZDNaR3RyZzNXZGUwb0NzVEFOMC4iLCJzdWIiOiIyUVB5Y3pBa3BQMmh0UlBFcFNZXy1UeUo5WTY2d1o3NlY0NG1sek1aTmJRIiwidGlkIjoiYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjIiwidXRpIjoicFZFdmZkR284a0tlTFlWTU9iQWdBQSIsInZlciI6IjIuMCIsInNhbWFjY291bnRuYW1lIjoiZHV0dGkxIn0.IZgXvJ1Y5Cu0OXFGQTMZHajAbT4hqvVj32esRvgBKbhEEetGEeMLFnYi7AWLIkw6X29EEWEONZ5lOFMOqmhLOHk8UrO7aMPX4ReDoe3oE45Cipn4JGY3cviRw8SuRUvYgX1w2OiLSWaz5nWhxBNZLvR2eZfQTKaWZpXO4TfbMSIhQtptehQIqj3q-zsbfySefGETM5EEU9cUJSe4RwfOIVKweoFsGlYNAMEtQv2JBq4BBVzO0a8Xixrefo0s5YKTT7PZBZyDU6AtkTi4ElnpKUbmt6qtTyr8NujTWiUHusuCQfwttzNl2hDWfz-r8HgxhHD4e8of0TrtcMu7yNbT4w'


const testWorker = () => {
  const executor = async ({ document, variables }) => {
    const query = print(document)
    const fetchResult = await fetch('http://example.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    })
    return fetchResult.json()
  }

  try {
    const pingWorker = (_worker) => {
      _worker.postMessage({destroyReferenceServer: true})
  
    }

    
    const worker = new Worker('./src/serverGen.js', {
      workerData: {
        port: '1111',
        kubeApiUrl: 'https://east.npe.duck.master.kube.t-mobile.com:6443',
        schemaToken: _token
      }
    });
  
  
    worker.on('message', async(msg) => {
  
      const {process, server_uri } = msg;
      // load from endpoint
      // const schema2 = await loadSchema(server_uri, {
      //   loaders: [new UrlLoader()]
      // })
      // const schema = wrapSchema({
      //   schema: await introspectSchema(schema2),
      //   schema2
      // })

      // if(process === 'server-gen'){
      //   pingWorker(worker)
      // }
      // resolve(msg)      
    });
    worker.on('error', (code) => {
      throw `Worker stopped with exit code ${code}`
    });
    worker.on('exit', (code) => {
      if (code !== 0)
        throw `Worker stopped with exit code ${code}`;
    });
    // worker.postMessage({destroyReferenceServer: true})

    // worker.postMessage({destroyReferenceServer: true})

  } catch (error) {
    console.log('error', error)
  }





};

const rehydrateIntrospection = (intsrpctn, subMap, paths) => {
  for(let gqltype of intsrpctn.__schema.types){
    // console.log(gqltype.name)
    // ioK8sApiCoreV1PodList

    // let subList=[];
    // letQueryList=[];
    // if(subMap[gqltype.name.toUpperCase()]){
    //   // console.log('FOUND SUB', gqltype.name)
    // }else{
    //   console.log('NOT SUB', gqltype.name)
    // }


    // if(gqltype.name.toUpperCase().includes(('query').toUpperCase())){
    //   // console.log(gqltype)
    //   console.log('a',Object.keys(gqltype))
    //   gqltype.fields.forEach((fieldObj) => {
    //     console.log(fieldObj.name)
    //     if(fieldObj.name.toUpperCase().includes(('ioK8sApiAutoscalingV2beta2HorizontalPodAutoscaler').toUpperCase())){
    //       console.log('FOUNDDDD',fieldObj)

    //     }
    //   })
    //   // console.log('b', )
      
    //   // console.log(gqltype.fields)
    // }     
    
  }
}

//REFERENCE MESSAGE
// worker.on('message', async(msg) => {

//   const message = msg;
//   worker.postMessage({destroyReferenceServer: true})
//   // console.log(Object.keys(msg.schemaIntrospection.__schema.types));
//   // const fOas = await JSON.parse(msg.finalOas);
//   // const parse_oass = await JSON.parse(msg.str_oas);
//   // fOas.oass=parse_oass;
//   // for(let operation of Object.keys(fOas.operations)){
//   //   // const lol = fOas[operation];
//   //   fOas.operations[operation]['oas']= parse_oass[0];
//   // }
//   // const schema = await createSchema(
//   //   null,
//   //   'https://east.npe.duck.master.kube.t-mobile.com:6443',
//   //   msg.mappedK8Paths,
//   //   msg.mappedWatchPath,
//   //   msg.mappedNamespacedPaths,
//   //   fOas
//   // ); // takes the longest
//   // console.log('Generate Schema 9000')
//   // console.log('finalOas', msg.finalOas);
//   // console.log(Object.keys(msg.schemaIntrospection.__schema.directives));
//   // console.log('return!', msg.subscriptions);
//   // let subMap={};
//   // for(let subObj of msg.subscriptions){
//   //   subMap[subObj.schemaType.toUpperCase()]= true;
//   // }
//   // rehydrateIntrospection(msg.schemaIntrospection, subMap, msg.paths);
//   //WHAT DO I NEED?
//   //All types
//   // Map from type to path
//   // request types
//   // arguments


//   // for(let gqltype of msg.schemaIntrospection.__schema.types){
//   //   // console.log(gqltype.name)
//   //   // ioK8sApiCoreV1PodList

//   //   if(gqltype.name.toUpperCase().includes(('query').toUpperCase())){
//   //     // console.log(gqltype)
//   //     console.log('a',Object.keys(gqltype))
//   //     gqltype.fields.forEach((fieldObj) => {
//   //       console.log(fieldObj.name)
//   //       if(fieldObj.name.toUpperCase().includes(('ioK8sApiAutoscalingV2beta2HorizontalPodAutoscaler').toUpperCase())){
//   //         console.log('FOUNDDDD',fieldObj)

//   //       }
//   //     })
//   //     // console.log('b', )
      
//   //     // console.log(gqltype.fields)
//   //   }     
    
//   //   // if(gqltype.name.toUpperCase().includes(('apiV1NamespacePodExec').toUpperCase())){
//   //   //   console.log(gqltype)
//   //   //   // console.log(gqltype.fields)
//   //   // }  
//   //   // if(gqltype.inputFields !== null){
//   //   //   console.log(gqltype)
//   //   //   // console.log(gqltype.fields)
//   //   // }
//   //   // if(gqltype.name.toUpperCase().includes(('metadata').toUpperCase())){
//   //   //   console.log(gqltype)
//   //   //   console.log(gqltype.fields)
//   //   // }
    
//   // }
//   // GENERATES NEW GQL SERVER FOR SPECIFIC CLUSTER

//   // console.log('returned!', msg.schemaIntrospection);
//   // const newSchema = buildSchema(msg.schemaIntrospection);
//   // const mergedSchema = await testHydateSubscriptions(
//   //   newSchema,
//   //   msg.subscriptions,
//   //   msg.watchableNonNamespacePaths,
//   //   msg.mappedNamespacedPaths
//   // )
//   // console.log('mergedSchema', mergedSchema);

//   // generateGqlServer2(1111, mergedSchema)

//   // hydration idea
//   // get list of types
//   // for each type get args
//   // using args create resolver to hit api with args
  
// });



const flattenSchema = () => {

}


// cache.set('test', 'test');
// console.log('oiiiiiiii', cache.get('test'));
testWorker() // NODE WORKER CALL
// testWorker2()

// Resolve Refs R&D
// generateClusterSchema(
//   'https://east.npe.duck.master.kube.t-mobile.com:6443',
//   _token
// )

// generateClusterSchema(
//   'https://east.npe.duck.master.kube.t-mobile.com:6443',
//   _token
// )



app.get('/gen', async(req, res) => {

  // new Promise((resolve, reject) => {
  //   generateClusterSchema(
  //     'https://east.npe.duck.master.kube.t-mobile.com:6443',
  //     _token
  //   )
  // })
  console.log('HIT!')
  const schema2 = await loadSchema('http://localhost:9090/gql', {
    loaders: [new UrlLoader()]
  })
  // const schema = wrapSchema({
  //   schema: await introspectSchema(schema2),
  //   schema2
  // })
  res.send('generating!')
});


const testImmediate = async() => {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      console.log('Start 1')
      const lol = 4000000000;
      let iter=0;
      while(iter < lol){
        iter++
      }
      console.log('End 1')
  
      setImmediate(() => {
        console.log('Start 2')
    
        const lol = 4000000000;
        let iter=0;
        while(iter < lol){
          iter++
        }
        
        console.log('yay 2')
        resolve('wow')
      })
    });
  })

}
app.get('/stats', async(req, res) => {


  testImmediate().then((data) => res.send(data))



  // new Promise((resolve, reject) => {
  //   console.log('Start 3')

  //   const lol = 4000000000;
  //   let iter=0;
  //   while(iter < lol){
  //     iter++
  //   }
  //   resolve()
    
  // }).then(() => {
  //   console.log('yay 3')
  // })

  // new Promise((resolve, reject) => {
  //   console.log('Start 4')
  
  //   const lol = 4000000000;
  //   let iter=0;
  //   while(iter < lol){
  //     iter++
  //   }
  //   resolve()
    
  // }).then(() => {
  //   console.log('yay 4')
  // })
  

});


// });


// blocked((time, stack) => {
//   console.log(`Blocked for ${time}ms, operation started here:`, stack)
// })

serverStart();


//TODO
//how to handle get delete post etc same path different operations