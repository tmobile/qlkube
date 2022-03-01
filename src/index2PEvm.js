const cors = require('cors');
require('dotenv').config();
const { PubSub } = require('apollo-server-express');
const { logger } = require('./log');
const express = require('express');
const cache = require('./cache/serverObjCache')();

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

const serverGen = require('./serverGen')
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
app.get('/stats', async(req, res) => {
  checkServerConnections();
});

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
const generateClusterSchema = async(kubeApiUrl, schemaToken, emitterId) => {
  try {
    logger.debug('Generating cluster schema', kubeApiUrl);
    const em = new events.EventEmitter();
  
    const oasRaw = await getOpenApiSpec(kubeApiUrl, schemaToken);
    // console.log('Generate Schema 1')
    const oasWatchable = deleteDeprecatedWatchPaths(oasRaw);
    // console.log('Generate Schema 2')
    const subs = await getWatchables(oasWatchable);
    // console.log('Generate Schema 3')
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
    new Promise(async (resolve, reject) => {
      const schema = createSchema(
        oas,
        kubeApiUrl,
        mappedK8Paths,
        subs.mappedWatchPath,
        subs.mappedNamespacedPaths
      ); // takes the longest
      resolve(schema);

    }).then((data) => em.emit(emitterId, 'finnnnn'))

    console.log('Gen return emitter', emitterId)
    return em;
  } catch (error) {
    
  }

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

const testWorker = () => {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./src/serverGen.js', {
      workerData: {
        port: '1111',
        kubeApiUrl: 'https://east.npe.duck.master.kube.t-mobile.com:6443',
        schemaToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik1yNS1BVWliZkJpaTdOZDFqQmViYXhib1hXMCJ9.eyJhdWQiOiI1YzllODJiNS03NzBiLTQ2NzYtYjZiOC0zNzU5ZDdiNGEwMmIiLCJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjL3YyLjAiLCJpYXQiOjE2NDYwNjU5ODAsIm5iZiI6MTY0NjA2NTk4MCwiZXhwIjoxNjQ2MDY5ODgwLCJlbWFpbCI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwiZ3JvdXBzIjpbIkF0ZXJuaXR5IFVzZXJzIiwiTGljZW5zZV9XaW4xMF9SU0FUIEZ1bGwiLCJQR0hOLUlTQS1Mb2FkX0JhbGFuY2VyLVBSRCIsIk1vYmlsZUlyb25fRU5UIiwiUm9sZV9UTVVTX0ZURSIsIkxpY2Vuc2VfTWljcm9zb2Z0IE9mZmljZSAzNjUgeDg2IE9uLURlbWFuZCIsIlNBIE5vdGlmaWNhdGlvbnMiLCJMaWNlbnNlX01pY3Jvc29mdCBBenVyZSBFTVMiLCJBdGVybml0eSBFVFMiLCJSb2xlX1RlY2hub2xvZ3lfQWxsIiwiUmVsaWFuY2VXb3JrTG9nIiwiTGljZW5zZV9NYWtlIE1lIEFkbWluIEVucm9sbG1lbnQiLCJEcnV2YSBVc2VycyBXZXN0IiwiU3BsdW5rVmlld19BbGxVc2VycyIsIk9UX1RlY2hub2xvZ3lfQWxsIiwiRFNHX1dlYmJfRlRFIiwiTGljZW5zZV9EcnV2YSBJblN5bmMiLCJMaWNlbnNlX0RvY2tlciIsIkFwcERpc3RfUlNBVCBGdWxsIiwiQXBwRGlzdF9NaWNyb3NvZnQgT2ZmaWNlIDM2NSB4ODYgT24tRGVtYW5kIiwiQ2l0cml4X0NhcmVfUmVtb3RlQWNjZXNzIiwiVlBOLU5ldHdvcmstRUlUIiwiT0tUQV9BcHByZWNpYXRpb24tWm9uZSIsIkFsbG93IFdvcmtzdGF0aW9uIEVsZXZhdGlvbiIsIkFwcGRpc3RfRHJ1dmEgdXNlcnMgZXhjbHVkaW5nIEV4ZWNzIiwiVGVjaG5vbG9neV9STkVcdTAwMjZPXzIiLCJPVF9GVEUiLCJNSV9BcHBzX1ROYXRpb25fV3JhcHBlZCJdLCJuYW1lIjoiVXR0aSwgRGV0cmljaCIsIm5vbmNlIjoiNzk4OWMxZTctNDY4YS00NTlhLTlkMTEtZjI1MjU4YjJlNjQxIiwib2lkIjoiMTdkOTI5YjItNjkwNi00N2UwLThjYTktM2FiYjM5NzJiYzdiIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiRGV0cmljaC5VdHRpMUBULU1vYmlsZS5jb20iLCJyaCI6IjAuQVJNQUM1Z1B2cG5kR1V1OWU3eHhvSnNDYkxXQ25sd0xkM1pHdHJnM1dkZTBvQ3NUQU4wLiIsInN1YiI6IjJRUHljekFrcFAyaHRSUEVwU1lfLVR5SjlZNjZ3Wjc2VjQ0bWx6TVpOYlEiLCJ0aWQiOiJiZTBmOTgwYi1kZDk5LTRiMTktYmQ3Yi1iYzcxYTA5YjAyNmMiLCJ1dGkiOiJVVkNhdDZ3SkZVZXUwTTZJUmFlT0FBIiwidmVyIjoiMi4wIiwic2FtYWNjb3VudG5hbWUiOiJkdXR0aTEifQ.kRkM11vzpoelDws90x5CaYrskCrp5p-ny9ZP4h8EyXmixM8KpIkFNL0uhEe7BLVrFAkH2usbHeFvhoPMLuxOOGx1-j4MNj3oYx3w5-KZjW2VPp_4o9FKQsHSfMZjFIMaHaa-EuhAL4ZLYtwCeCzSAdAo-UYKq2C9kAxYRtlH6FlBKSBZM-8DSJ9ymcpbalsYN22ye7Coy4x9YVmlEvrxrMBG9E-Ek1rTqOu9xkvjwFXLtYDZK1u_XBHjRGGe1p5LX79qWFnYuvDMyva6__R38YC0kBe75JA19XgO8uKgx5IAiPy6UlxdsujDO04gjrxOMRsowyb4DSGKdeAMO7N50Q'
      }
    });
    worker.on('message', async(msg) => {
      console.log(Object.keys(msg.schemaIntrospection.__schema));
      console.log(Object.keys(msg.schemaIntrospection.__schema));
      console.log('return!');
      for(let gqltype of msg.schemaIntrospection.__schema.types){
        console.log(gqltype.name)

        // if(gqltype.name === 'heck'){
        //   console.log(gqltype)
        // }
        
      }
      // GENERATES NEW GQL SERVER FOR SPECIFIC CLUSTER

      // console.log('returned!', msg.schemaIntrospection);
      // const newSchema = buildSchema(msg.schemaIntrospection);
      // const mergedSchema = await testHydateSubscriptions(
      //   newSchema,
      //   msg.subscriptions,
      //   msg.watchableNonNamespacePaths,
      //   msg.mappedNamespacedPaths
      // )
      // console.log('mergedSchema', mergedSchema);

      // generateGqlServer2(1111, mergedSchema)
    });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0)
        reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });

};
const _token= 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik1yNS1BVWliZkJpaTdOZDFqQmViYXhib1hXMCJ9.eyJhdWQiOiI1YzllODJiNS03NzBiLTQ2NzYtYjZiOC0zNzU5ZDdiNGEwMmIiLCJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjL3YyLjAiLCJpYXQiOjE2NDYwNjU5ODAsIm5iZiI6MTY0NjA2NTk4MCwiZXhwIjoxNjQ2MDY5ODgwLCJlbWFpbCI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwiZ3JvdXBzIjpbIkF0ZXJuaXR5IFVzZXJzIiwiTGljZW5zZV9XaW4xMF9SU0FUIEZ1bGwiLCJQR0hOLUlTQS1Mb2FkX0JhbGFuY2VyLVBSRCIsIk1vYmlsZUlyb25fRU5UIiwiUm9sZV9UTVVTX0ZURSIsIkxpY2Vuc2VfTWljcm9zb2Z0IE9mZmljZSAzNjUgeDg2IE9uLURlbWFuZCIsIlNBIE5vdGlmaWNhdGlvbnMiLCJMaWNlbnNlX01pY3Jvc29mdCBBenVyZSBFTVMiLCJBdGVybml0eSBFVFMiLCJSb2xlX1RlY2hub2xvZ3lfQWxsIiwiUmVsaWFuY2VXb3JrTG9nIiwiTGljZW5zZV9NYWtlIE1lIEFkbWluIEVucm9sbG1lbnQiLCJEcnV2YSBVc2VycyBXZXN0IiwiU3BsdW5rVmlld19BbGxVc2VycyIsIk9UX1RlY2hub2xvZ3lfQWxsIiwiRFNHX1dlYmJfRlRFIiwiTGljZW5zZV9EcnV2YSBJblN5bmMiLCJMaWNlbnNlX0RvY2tlciIsIkFwcERpc3RfUlNBVCBGdWxsIiwiQXBwRGlzdF9NaWNyb3NvZnQgT2ZmaWNlIDM2NSB4ODYgT24tRGVtYW5kIiwiQ2l0cml4X0NhcmVfUmVtb3RlQWNjZXNzIiwiVlBOLU5ldHdvcmstRUlUIiwiT0tUQV9BcHByZWNpYXRpb24tWm9uZSIsIkFsbG93IFdvcmtzdGF0aW9uIEVsZXZhdGlvbiIsIkFwcGRpc3RfRHJ1dmEgdXNlcnMgZXhjbHVkaW5nIEV4ZWNzIiwiVGVjaG5vbG9neV9STkVcdTAwMjZPXzIiLCJPVF9GVEUiLCJNSV9BcHBzX1ROYXRpb25fV3JhcHBlZCJdLCJuYW1lIjoiVXR0aSwgRGV0cmljaCIsIm5vbmNlIjoiNzk4OWMxZTctNDY4YS00NTlhLTlkMTEtZjI1MjU4YjJlNjQxIiwib2lkIjoiMTdkOTI5YjItNjkwNi00N2UwLThjYTktM2FiYjM5NzJiYzdiIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiRGV0cmljaC5VdHRpMUBULU1vYmlsZS5jb20iLCJyaCI6IjAuQVJNQUM1Z1B2cG5kR1V1OWU3eHhvSnNDYkxXQ25sd0xkM1pHdHJnM1dkZTBvQ3NUQU4wLiIsInN1YiI6IjJRUHljekFrcFAyaHRSUEVwU1lfLVR5SjlZNjZ3Wjc2VjQ0bWx6TVpOYlEiLCJ0aWQiOiJiZTBmOTgwYi1kZDk5LTRiMTktYmQ3Yi1iYzcxYTA5YjAyNmMiLCJ1dGkiOiJVVkNhdDZ3SkZVZXUwTTZJUmFlT0FBIiwidmVyIjoiMi4wIiwic2FtYWNjb3VudG5hbWUiOiJkdXR0aTEifQ.kRkM11vzpoelDws90x5CaYrskCrp5p-ny9ZP4h8EyXmixM8KpIkFNL0uhEe7BLVrFAkH2usbHeFvhoPMLuxOOGx1-j4MNj3oYx3w5-KZjW2VPp_4o9FKQsHSfMZjFIMaHaa-EuhAL4ZLYtwCeCzSAdAo-UYKq2C9kAxYRtlH6FlBKSBZM-8DSJ9ymcpbalsYN22ye7Coy4x9YVmlEvrxrMBG9E-Ek1rTqOu9xkvjwFXLtYDZK1u_XBHjRGGe1p5LX79qWFnYuvDMyva6__R38YC0kBe75JA19XgO8uKgx5IAiPy6UlxdsujDO04gjrxOMRsowyb4DSGKdeAMO7N50Q'
const testWorker2 = () => {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./src/serverGen.js', {
      workerData: {
        port: '1112',
        kubeApiUrl: 'https://east.npe.duck.master.kube.t-mobile.com:6443',
        schemaToken: _token
      }
    });
    worker.on('message', (msg) => {
      // console.log(msg);
      // GENERATES NEW GQL SERVER FOR SPECIFIC CLUSTER
      const generateGqlServer = async(port=1111, schema) => {
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
            console.log('GEN NEW SERVER COMPLETE++++++222222', port);

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
      const newSchema = buildSchema(msg)
      generateGqlServer(1112, newSchema)

    });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0)
        reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });

};


const testEmitter = async() => {
  const em1 = await generateClusterSchema(
    'https://east.npe.duck.master.kube.t-mobile.com:6443',
    _token,
    'test'
  );
  console.log('return', em1)
  em1.on('test', data => {
    console.log('data', data)
    // ws?.send(JSON.stringify(data))
  });
}

// serverStart();
// cache.set('test', 'test');
// console.log('oiiiiiiii', cache.get('test'));
// testWorker() // NODE WORKER CALL
// testWorker2()

testEmitter()
testEmitter()
