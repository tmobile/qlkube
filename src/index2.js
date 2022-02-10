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
const watch = require('./watch');
const path = require('path');

//------
const app = express()
const bodyParser = require('body-parser');
const { createClient } = require('graphql-ws');
const ws = require('ws'); // yarn add ws
const { useServer }  = require('graphql-ws/lib/use/ws');
var events = require('events');
const Crypto = require('crypto');
var process = require('process')
const serverCache = require('./cache/serverGenCache');
const pubsub = new PubSub();
const wsServer = require('http').createServer();
const WebSocketServer  = require('ws').Server; // yarn add ws
const wss = new WebSocketServer({ server: wsServer });
var process = require('process');
const { default: cluster } = require('cluster');
//------

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
const inCluster = process.env.IN_CLUSTER !== 'false';
logger.info({ inCluster }, 'cluster mode configured');

const _token = `eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik1yNS1BVWliZkJpaTdOZDFqQmViYXhib1hXMCJ9.eyJhdWQiOiI1YzllODJiNS03NzBiLTQ2NzYtYjZiOC0zNzU5ZDdiNGEwMmIiLCJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjL3YyLjAiLCJpYXQiOjE2NDQ1MTU3ODksIm5iZiI6MTY0NDUxNTc4OSwiZXhwIjoxNjQ0NTE5Njg5LCJlbWFpbCI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwiZ3JvdXBzIjpbIkF0ZXJuaXR5IFVzZXJzIiwiTGljZW5zZV9XaW4xMF9SU0FUIEZ1bGwiLCJQR0hOLUlTQS1Mb2FkX0JhbGFuY2VyLVBSRCIsIk1vYmlsZUlyb25fRU5UIiwiUm9sZV9UTVVTX0ZURSIsIkxpY2Vuc2VfTWljcm9zb2Z0IE9mZmljZSAzNjUgeDg2IE9uLURlbWFuZCIsIlNBIE5vdGlmaWNhdGlvbnMiLCJMaWNlbnNlX01pY3Jvc29mdCBBenVyZSBFTVMiLCJBdGVybml0eSBFVFMiLCJSb2xlX1RlY2hub2xvZ3lfQWxsIiwiUmVsaWFuY2VXb3JrTG9nIiwiTGljZW5zZV9NYWtlIE1lIEFkbWluIEVucm9sbG1lbnQiLCJTcGx1bmtWaWV3X0FsbFVzZXJzIiwiT1RfVGVjaG5vbG9neV9BbGwiLCJEU0dfV2ViYl9GVEUiLCJBcHBEaXN0X1JTQVQgRnVsbCIsIkFwcERpc3RfTWljcm9zb2Z0IE9mZmljZSAzNjUgeDg2IE9uLURlbWFuZCIsIkNpdHJpeF9DYXJlX1JlbW90ZUFjY2VzcyIsIlZQTi1OZXR3b3JrLUVJVCIsIk9LVEFfQXBwcmVjaWF0aW9uLVpvbmUiLCJBbGxvdyBXb3Jrc3RhdGlvbiBFbGV2YXRpb24iLCJUZWNobm9sb2d5X1JORVx1MDAyNk9fMiIsIk9UX0ZURSIsIk1JX0FwcHNfVE5hdGlvbl9XcmFwcGVkIl0sIm5hbWUiOiJVdHRpLCBEZXRyaWNoIiwibm9uY2UiOiIzZWViZDNjYy01NDIxLTQ3ODctODAzNC05ZjBlYjgwOThiN2EiLCJvaWQiOiIxN2Q5MjliMi02OTA2LTQ3ZTAtOGNhOS0zYWJiMzk3MmJjN2IiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJEZXRyaWNoLlV0dGkxQFQtTW9iaWxlLmNvbSIsInJoIjoiMC5BUk1BQzVnUHZwbmRHVXU5ZTd4eG9Kc0NiTFdDbmx3TGQzWkd0cmczV2RlMG9Dc1RBTjAuIiwic3ViIjoiMlFQeWN6QWtwUDJodFJQRXBTWV8tVHlKOVk2NndaNzZWNDRtbHpNWk5iUSIsInRpZCI6ImJlMGY5ODBiLWRkOTktNGIxOS1iZDdiLWJjNzFhMDliMDI2YyIsInV0aSI6InNpdmdKN3B1OWstOVVydTVocVFtQUEiLCJ2ZXIiOiIyLjAiLCJzYW1hY2NvdW50bmFtZSI6ImR1dHRpMSJ9.JW5lMrfmIazw86dPbzWJqhbkcqzcob3Zitd3MOgBl94OnUcslaiYm3E776Mhp9nP2hIIAU1wKd44t3BZNtjC63M-LrqOiB3YCltzL0HtagQdWIrZ5Jpg197hLTv4SM-ZxfIV7qs2SCYVo57W0oU8l6y41gR18Zduabn-g2qNCxeLOZEob5xY9otp29bMjHobrp15yByA4OBGhslfnCuYa0SbYhMHlksAghZPdGJ8DuTQHhmzUSdzdILtORECmvqgIGbyzHa_lNAJOCnY9rtbzVG9yCf7VexcfcGnSzSUyKNyfRWMmzG71EJ0Sh7AKXtYi1RlcLeKxeDOZXnJCt9xPQ`

app.use(bodyParser.json());

// TEST QUERY
app.get('/gql', async(req, res) => {
  console.log(req?.body)
  const reqQuery= `query {
    listAppsV1NamespacedDeployment(namespace: "css-dev-duck-dev-w2") {
      items {
        metadata{
          name
          namespace
          labels
        }
        spec {
          selector {
            matchLabels
          }
        }
      }
    }
  }`;
  const _clusterUrl= 'https://west.dev.duck.master.kube.t-mobile.com:6443'
  const connectionParams= {
    authorization: `Bearer ${_token}`,
    clusterUrl: _clusterUrl,
    clientId: Date.now().toString(36) + Math.random().toString(36).substr(2),
  }

  res.send({
    data : await gqlServerRouter(
      null,
      _clusterUrl,
      null,
      null,
      _token,
      reqQuery,
      connectionParams,
      requestTypeEnum.query
    ) 
  })
});

app.post('/add', (req, res) => {
    console.log(req?.body?.testpath)
    res.send('test');
});


let clientInternalWsMap={};
let internalSubObjMap={}
let clientToInternalSubIdMap={};

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
        if(connectionParams?.clusterUrl&&clientId){  
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
        }
      }

      // END INTERNAL SOCKET
      else if(requestType === requestTypeEnum.close){
        logger.debug('Internal ws close request from', connectionParams.clientId)
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
      logger.debug('Meta websocket closed for', ws.clientId)
      for(let cachedInternalSubId of clientInternalWsMap[ws.clientId]){
        internalSubObjMap[cachedInternalSubId].dispose();
        delete internalSubObjMap[cachedInternalSubId];
      };
      delete clientInternalWsMap[ws.clientId]
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
      if(requestMode === requestTypeEnum.subscribe){
        serverCache.cacheServer(null, clusterUrl, serverUrl, freePort, serverObj);
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

// BASE SERVER STARTUP
const serverStart = () => {
  let PORT = `${process.env.SERVER_PORT}`;
  if (!process.env.SERVER_PORT) {
    PORT = 8080;
  }
  wsServer.on('request', app);
  wsServer.listen(PORT, () => {
    console.log('Ws server Listening on ' + wsServer.address().port)
  }) 
};

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

serverStart();