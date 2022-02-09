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

// TODO: remove the need for this
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
const inCluster = process.env.IN_CLUSTER !== 'false';
logger.info({ inCluster }, 'cluster mode configured');

app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send({data : 'Hello World!' })
});

app.post('/add', (req, res) => {
    console.log(req?.body?.testpath)
    // addPath(req?.body?.testpath)
    res.send('test');
});


let clientInternalWsMap={};
let internalSubObjMap={}

setInterval(() => {
  console.log('Servers', Object.keys(serverCache.servers))
  console.log('Ready Ports', serverCache.portQueue)
  console.log('Used Ports', serverCache.usedPorts)
  console.log('clientInternalWsMap', clientInternalWsMap)
  console.log('MEM_USAGE', process.memoryUsage().heapTotal/1000000)

  // console.log('servers', serverCache.servers)
}, 10000) 

// Keep track of client -> sub id
// Keep track of Subid -> internal sub obj
const pairSubToClient = (clientId, subObj, internalSubId) => {
  internalSubObjMap[internalSubId]= subObj;
  if(!clientInternalWsMap[clientId]){
    clientInternalWsMap[clientId]=[internalSubId]
    
  }else{
    newClientData= clientInternalWsMap;
    newClientSubList= newClientData?.[clientId] || [];
    newClientSubList.push(internalSubId);
    newClientData[clientId]= newClientSubList;
    clientInternalWsMap= newClientData;
  }
  console.log('clientData', clientInternalWsMap)
}


// META WEBSOCKET CONNECTION HANDLER
wss.on('connection', function connection(ws) {
  ws.on('message', function message(data) {
    try {
      const connectionMessage= JSON.parse(data);
      const { requestType, clientId, query, connectionParams }= connectionMessage;
      ws.clientId= clientId;
      console.log('received: %s', connectionParams?.clusterUrl, clientId);

      if(connectionParams?.clusterUrl&&clientId){
        console.log('IN');

        const emitterId = `${connectionParams?.clusterUrl}-${clientId}`;
        // console.log('clusterUrl', clusterUrl);
        gqlServerRouter(
          emitterId, 
          connectionParams?.clusterUrl, 
          clientId, 
          ws, 
          connectionParams?.authorization, 
          query,
          connectionParams
        )
      }
    } catch (error) {
      return {
        error: {
          errorPayload: error
        }
      }
    }
  });
  ws.on('close', () => {
    try {
      // End all internal websockets for disconnected client
      console.log('WS CLOSED...', ws.clientId, clientInternalWsMap[ws.clientId]);
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

  ws.send('NEW WEBSOCKET >:)');
});

const gqlServerRouter = async(emitterId, clusterUrl, clientId, ws, token, query, connectionParams) => {
  const genServerHandler = async(freePort) => {
    //if free -> get port and generate server;
    console.log('GENERATING SERVER')
    const { serverUrl, serverObj, error }= await generateGqlServer(freePort, clusterUrl, token);
    if(!error){
      console.log('brah no......')
      serverCache.cacheServer(null, clusterUrl, serverUrl, freePort, serverObj);

      console.log('CONNECTING!!!!')
      const emitter = connectSub(serverUrl, emitterId, clientId, query, connectionParams);
      serverCache.movePortUsed(freePort);
      emitter.on(emitterId, data => {
        ws.send(JSON.stringify(data))
      });
    }else {
      console.log('SERVER GENERATION FAILED')
    }
  }

  const gqlServerData= serverCache.getServer(clusterUrl);

  if(gqlServerData){
    const { gqlServerUrl, gqlServerClient }= gqlServerData;
    console.log('Server Exists!', clusterUrl);
    const emitter = connectSub(gqlServerUrl, emitterId, clientId, query, connectionParams);
    emitter.on(emitterId, data => {
      // console.log('Emitter Data Recieved!', JSON.stringify(data));
      ws.send(JSON.stringify(data))
    });
    //connect subscription
    //link emitter
  }else{
    console.log('CHECKING FREE PORTS', serverCache.portQueue)
    //check if free port
    const freePort= serverCache.getPort();
    if(freePort){
      console.log('Found a free port...')

      //if free -> get port and generate server;
      genServerHandler(freePort);
    }else{
      //if not -> recycle server, use port to generate server
      await serverCache.recycleServer();
      console.log('Need to recycle Server!!!!')

      gqlServerRouter(emitterId, clusterUrl, clientId, ws)

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
  wsServer.listen(8080, () => {
    // generateClusterSchema(
    //   'https://west.dev.duck.master.kube.t-mobile.com:6443',
    //   'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik1yNS1BVWliZkJpaTdOZDFqQmViYXhib1hXMCJ9.eyJhdWQiOiI1YzllODJiNS03NzBiLTQ2NzYtYjZiOC0zNzU5ZDdiNGEwMmIiLCJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjL3YyLjAiLCJpYXQiOjE2NDQzMzc1OTIsIm5iZiI6MTY0NDMzNzU5MiwiZXhwIjoxNjQ0MzQxNDkyLCJlbWFpbCI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwiZ3JvdXBzIjpbIkF0ZXJuaXR5IFVzZXJzIiwiTGljZW5zZV9XaW4xMF9SU0FUIEZ1bGwiLCJQR0hOLUlTQS1Mb2FkX0JhbGFuY2VyLVBSRCIsIk1vYmlsZUlyb25fRU5UIiwiUm9sZV9UTVVTX0ZURSIsIkxpY2Vuc2VfTWljcm9zb2Z0IE9mZmljZSAzNjUgeDg2IE9uLURlbWFuZCIsIlNBIE5vdGlmaWNhdGlvbnMiLCJMaWNlbnNlX01pY3Jvc29mdCBBenVyZSBFTVMiLCJBdGVybml0eSBFVFMiLCJSb2xlX1RlY2hub2xvZ3lfQWxsIiwiUmVsaWFuY2VXb3JrTG9nIiwiTGljZW5zZV9NYWtlIE1lIEFkbWluIEVucm9sbG1lbnQiLCJTcGx1bmtWaWV3X0FsbFVzZXJzIiwiT1RfVGVjaG5vbG9neV9BbGwiLCJEU0dfV2ViYl9GVEUiLCJBcHBEaXN0X1JTQVQgRnVsbCIsIkFwcERpc3RfTWljcm9zb2Z0IE9mZmljZSAzNjUgeDg2IE9uLURlbWFuZCIsIkNpdHJpeF9DYXJlX1JlbW90ZUFjY2VzcyIsIlZQTi1OZXR3b3JrLUVJVCIsIk9LVEFfQXBwcmVjaWF0aW9uLVpvbmUiLCJBbGxvdyBXb3Jrc3RhdGlvbiBFbGV2YXRpb24iLCJUZWNobm9sb2d5X1JORVx1MDAyNk9fMiIsIk9UX0ZURSIsIk1JX0FwcHNfVE5hdGlvbl9XcmFwcGVkIl0sIm5hbWUiOiJVdHRpLCBEZXRyaWNoIiwibm9uY2UiOiI5OGJjNjcwOC0zNzAwLTRiZGMtOWZjYS0yM2M5ZjBhY2IwNmQiLCJvaWQiOiIxN2Q5MjliMi02OTA2LTQ3ZTAtOGNhOS0zYWJiMzk3MmJjN2IiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJEZXRyaWNoLlV0dGkxQFQtTW9iaWxlLmNvbSIsInJoIjoiMC5BUk1BQzVnUHZwbmRHVXU5ZTd4eG9Kc0NiTFdDbmx3TGQzWkd0cmczV2RlMG9Dc1RBTjAuIiwic3ViIjoiMlFQeWN6QWtwUDJodFJQRXBTWV8tVHlKOVk2NndaNzZWNDRtbHpNWk5iUSIsInRpZCI6ImJlMGY5ODBiLWRkOTktNGIxOS1iZDdiLWJjNzFhMDliMDI2YyIsInV0aSI6ImZTZmUzakNWRTBxUVFOcXZWcVRCQUEiLCJ2ZXIiOiIyLjAiLCJzYW1hY2NvdW50bmFtZSI6ImR1dHRpMSJ9.AVxEIhZndzMoBjIVRsNjZU2ZrEDbRGSjxFvH-xTjjcSITD80luQDm7wMRzHvdY3Zq2pRJ7tCp1uBsy6iVByESUj9kGSlMKsRzhVpcUJ3ypA9KI1my9O0MNZW_y7ISNO0_Z4kYXxSz6ugE99KlKp610DxShx-MLpnuPKhmFa3DRUNmOufaDlZQkmYCiKTOCXU3qUDOcXMsM4udxbD5KObPYoLvv8oiPZA_J9Ss-D8MO9miABrzr52jb812UYifA6nO-Q8z_CaHq69zrsDDweLSShKqUMVSC1ZMWUID-yW92GNHZgz76F8G3rxBWbWlJP8uUPHsLYIImJn_zpyVgf_FA'
    // )
    console.log('Ws server Listening on ' + wsServer.address().port)
  }) 
};

const generateClusterSchema = async(kubeApiUrl, schemaToken) => {
  console.log('GENERATING CLUSTER SCHEMA', kubeApiUrl)
  const oasRaw = await getOpenApiSpec(kubeApiUrl, schemaToken);
  const oasWatchable = deleteDeprecatedWatchPaths(oasRaw);
  const subs = await getWatchables(oasWatchable);
  const oas = deleteWatchParameters(oasWatchable);
  const graphQlSchemaMap = await utilities.mapGraphQlDefaultPaths(oas);
  if(graphQlSchemaMap.error){
    return graphQlSchemaMap;
  }
  // console.log('graphQlSchemaMap', graphQlSchemaMap)
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
  // generateGqlServer(1111, schema);
}

const generateGqlServer = async(port, kubeApiUrl, schemaToken) => {
  console.log('setting at port', port)
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
    console.log('server setup')
    return {
      serverUrl: `ws://localhost:${port}/gql`,
      serverObj: wsserver
    }
  }
}

// CONNECT TO INTERNAL GQL SERVER
const connectSub = (wsUrl, emitterId, clientId, query, connectionParams) => {
  try {
    console.log('CONECTING TO', wsUrl, query)
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

    // subscription
    (async () => {
      const onNext = (val) => {
        /* handle incoming values */
        console.log('message!', val)
        em.emit(emitterId, val);
      };
      
      await client.subscribe(
        {
          query: query,
        },
        {
          next: onNext,
          // error: reject,
          // complete: resolve,
          error: (er) => console.log('Subscription error!' ,er),
          complete: (er) => console.log('Subscription complete!'),
        },
      );
      console.log('SUB SUCCESS!?...')
      const internalSubId = Date.now().toString(36) + Math.random().toString(36).substr(2);
      pairSubToClient(clientId, client, internalSubId)

    })();

    return em;
  } catch (error) {
    console.log('Connection failed...', error)
  }
}

serverStart();