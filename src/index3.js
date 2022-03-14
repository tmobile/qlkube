const express = require('express');
const nodeFs = require('fs');
require('dotenv').config();
const { logger } = require('./log');
const cors = require('cors');

const { Worker } = require('worker_threads');
const wsServer = require('http').createServer();
const WebSocketServer  = require('ws').Server; // yarn add ws
const wss = new WebSocketServer({ server: wsServer });
const path = require('path')

//------

const bodyParser = require('body-parser');
var process = require('process')
const serverCache = require('./cache/serverCache');

const { connectSub, connectQuery } = require('./utils/internalServerConnect');
const { workerProcesseesEnum, workerCommandEnum } = require('./enum/workerEnum')
//------

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
const inCluster = process.env.IN_CLUSTER !== 'false';
logger.info({ inCluster }, 'cluster mode configured');

let clientInternalWsMap={};
let internalSubObjMap={}
let clientToInternalSubIdMap={};
let rougeSocketMap={};

const app = express();
app.use(cors());
app.use(bodyParser.json());

let currentGeneratingServers= [];
let pre_connectClientQueue= {};
let connectClientQueue= {};

let WORKER_MAP= {};
// GQL QUERIES
// how to handle...
// 1 return promise that has set interval checking completed servers
// 2 create promis and pass it all the way into connect client queue -> call resolver when server completes
app.get('/gql', async(req, res) => {
    if(req?.headers?.connectionparams){
      const queryParams= JSON.parse(req?.headers?.connectionparams);
      const { query, authorization, clusterUrl }= queryParams;

      const queryCallbacks = {
        isGenerating: () => {
          res.write(JSON.stringify({
            status: 'generating'
          }))
        },
        queryServer: async(gqlServerUrl, connectionParams, query) => {
          const queryResponse= await connectQuery(gqlServerUrl, query, connectionParams);
          console.log('queryResponse', queryResponse)
          res.write(JSON.stringify({
            data:  queryResponse,
            status: 'complete'
          }));
          res.end()
        }
      }
      
      gqlServerRouter(
        null,
        clusterUrl,
        null,
        null,
        authorization,
        query,
        queryParams,
        requestTypeEnum.query,
        queryCallbacks
      ) 
    }

});



const requestTypeEnum={
  subscribe: 'subscribe',
  close: 'close',
  query: 'query',
  query_ping: 'query_ping'
};

// setInterval(() => {
//   // console.log(' ')
//   // console.log(' ')
//   // console.log(' ')

//   // console.log('Servers', Object.keys(serverCache.servers))
//   // // console.log('Servers', serverCache.servers)
//   // console.log('internalSubObjMap', internalSubObjMap)
//   // console.log('clientToInternalSubIdMap', clientToInternalSubIdMap) 	branch = feature/qlkube2

//   // console.log('clientInternalWsMap', clientInternalWsMap)
//   console.log('clientToInternalSubIdMap',clientToInternalSubIdMap)
//   for(let idk of Object.keys(clientToInternalSubIdMap)){
//     // console.log('--', idk, clientToInternalSubIdMap[idk]?.length)
//   }
//   console.log('MEM_USAGE', process.memoryUsage().heapTotal/1000000)
//   // checkServerConnections()
// }, 20000) 



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
  if(rougeSocketMap[clientSubId]){
    setTimeout(() => {
      console.log('DISPOSE - psc', clientSubId)
      subObj.dispose();
      delete rougeSocketMap[clientSubId]
    }, 20000)

    return;
  }

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

      // SUBSCRIPTION REQUEST :: CONNECT
      if(requestType === requestTypeEnum.subscribe){
        ws.clientId= clientId;
        // logger.debug('Internal ws subscribe request from', connectionParams.clientId);
        console.log('+++++++++++++', connectionParams.clientSubId)
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
        console.log('-------------', connectionParams.clientSubId)

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
    // setTimeout(() => {
      console.log('Closing internal ws', clientSubId)

      const internalSocketId= clientToInternalSubIdMap[clientSubId];
      const internalSubObj = internalSubObjMap[internalSocketId];
      if(internalSubObj){
        setTimeout(() => {
          console.log('DSIPOSE - dest intrnl ', clientSubId)
          internalSubObj?.dispose();
          delete internalSubObjMap[internalSocketId];
          delete clientToInternalSubIdMap[clientSubId];
          if(clientInternalWsMap?.[clientId]){
            const filteredClientInternalWs= clientInternalWsMap[clientId].filter((intsbid) => intsbid !== internalSocketId);
            clientInternalWsMap[clientId]= filteredClientInternalWs;
          }
        }, 25000)

      }else{
        rougeSocketMap[clientSubId]= clientId;
      }

    // }, INTRNL_SOCKET_END_TIMEOUT)

  } catch (error) {
    console.log('destroySpeifiedInternalWebsocket ' + error )
  }

}

const checkAndRemoveWaitingConnection = () => {
  for(let clstrUrl of connectClientQueue){

  }
}

// ENDS ALL CACHED ROUTING DATA FOR CLIENT
const destroyCachedDataForClient = (wsId) => {
  try {
    // setTimeout(() => {
      logger.debug('Internal ws close request from', wsId)
      let internalSubsForClient=[];
      const checker= clientInternalWsMap?.[wsId]
      if(wsId&&clientInternalWsMap?.[wsId]?.length > 0){
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
    // }, INTRNL_SOCKET_END_TIMEOUT)

  } catch (error) {
    console.log('destroyCachedDataForClient ' + error )

  }

}

let worker_servers_map= {};
let clusterUrl_serverUrl_map= {};
let WORKER_JOB_QUEUE= [];

const workerStatusEnum = {
  idle: 'idle',
  busy: 'busy'
}
const workerProcessStatusEnum = {
  complete: 'complete',
  running: 'running',
  failed: 'failed'
}


const checkWorkersForServer = (serverId) => {
  // console.log('worker_servers_map', worker_servers_map)
  for(let [workerId, servers] of Object.entries(worker_servers_map)){
    // console.log(workerId, servers)

    if(servers&&servers?.includes(serverId)){
      return {
        gqlServerUrl: clusterUrl_serverUrl_map[serverId],
        workerHandler: workerId
      }
    }
  }
  return false;
  // return gql server uri for specific 
}

const getIdleWorker = () => {
  for(let [workerId, workerData] of Object.entries(WORKER_MAP)){
    if(workerData.status === workerStatusEnum.idle){
      return workerId
    }
  }
  return false;
}


const genServerHandler = async(
  freePort, 
  reqType,
  token,
  connectionParams,
  emitterId,
  clientId,
  clusterUrl,
  query,
  ws,
  queryCallback
) => {
  console.log('genServerHandler !')

    addConnectionToConnectQueue(
      reqType,
      clusterUrl,
      connectionParams,
      emitterId,
      clientId,
      query,
      queryCallback,
      ws
    );

    //add cluster to currently gen
    currentGeneratingServers.push(clusterUrl);
    //move port to pending
    serverCache.movePortQueueToPending(freePort, clusterUrl);

    // create job for worker
    // it will handle finding an idle thread
    onAddWorkerJob(
      workerCommandEnum.generate,
      {
        port: freePort,
        kubeApiUrl: clusterUrl,
        schemaToken: token
      }
    )
    queryCallback?.isGenerating()

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
  requestMode,
  queryCallbacks
) => {
  try {


    const internalServerUrl= checkWorkersForServer(clusterUrl);
    // SERVER EXISTS
    if(internalServerUrl){
      const { gqlServerUrl }= internalServerUrl;

      // if sub
      if(requestMode === requestTypeEnum.subscribe){
        setupSub(gqlServerUrl, emitterId, clientId, query, connectionParams, ws)
      }

      // if query
      if(requestMode === requestTypeEnum.query){
        queryCallbacks.queryServer(gqlServerUrl, connectionParams, query);
        return;
      }
    }
  
    // SERVER DOSENT EXIST
    else{
      // sendServerGenerationMessage(ws, 'start-generate')
      const freePort= serverCache.getUnusedPort();
      
      //BEING GENERATED
      if(connectClientQueue[clusterUrl]){
        //add to connect queue
        addConnectionToConnectQueue(
          requestMode,
          clusterUrl,
          connectionParams,
          emitterId,
          clientId,
          query,
          queryCallbacks,
          ws
        );
        queryCallbacks?.isGenerating()
      }

      // NOT GENERATING :: FREE PORT
      else if(freePort){
        const queryResponse = await genServerHandler(
          freePort, 
          requestMode,
          token,
          connectionParams,
          emitterId,
          clientId,
          clusterUrl,
          query,
          ws,
          queryCallbacks
          
        );
      }
  
      // NO FREE PORTS -> RECYCLE SERVER
      else{
        recycleServer(
          clusterUrl, 
          token,
          requestMode,
          connectionParams,
          emitterId,
          clientId,
          query,
          ws,
          queryCallbacks
        );
      }
    }
  } catch (error) {
    console.log('gqlServerRouter', error)

  }
}

const recycleServer = (
  replacementClusterUrl, 
  token,

  reqType,
  connectionParams,
  emitterId,
  clientId,
  query,
  ws,
  queryCallbacks
) => {
  // get least used server
  const leastUsedInternalServer= serverCache.getMinUsedServer();
  if(leastUsedInternalServer){
    const { threadId, clusterUrl, port }= leastUsedInternalServer;

    addConnectionToConnectQueue(
      reqType,
      replacementClusterUrl,
      connectionParams,
      emitterId,
      clientId,
      query,
      queryCallbacks,
      ws
    );
    //add cluster to currently gen
    currentGeneratingServers.push(replacementClusterUrl);
    serverCache.movePortUsedToPending(port, replacementClusterUrl);

    // create job to destroy internal server
    onAddWorkerJob(
      workerCommandEnum.destroyInternalServer,
      {
        kubeApiUrl: clusterUrl
      },
      threadId
    );
    // create job for worker
    // it will handle finding an idle thread
    onAddWorkerJob(
      workerCommandEnum.generate,
      {
        port: port,
        kubeApiUrl: replacementClusterUrl,
        schemaToken: token
      }
    )

  }

  
}

// create job
// check if any worker can take job
// ## if to thread is enabled, possibly assign job to worker too..?
// ## this works for one worker thread for now
const onAddWorkerJob = (comm, commArgs, toThread) => {
  const newJob = new WorkerJob(comm, commArgs, toThread);
  WORKER_JOB_QUEUE.push(newJob);
  const threadId = getIdleWorker();
  if(threadId){
    onFetchWorkerJob(threadId);
  }
}

// first checks for thread specific job for sent thread
// if no thread specific job
// get first job that dosent have allocatedThreadId
const onFetchWorkerJob = (threadId) => {
  if(WORKER_MAP[threadId].status !== workerStatusEnum.idle)
    return;

    let threadSpecificJob, nextJob, jobIndex;
    for(let [index, job] of WORKER_JOB_QUEUE.entries()){
      const { allocatedThreadId }= job;
      if(String(allocatedThreadId) === String(threadId)){
        threadSpecificJob= job;
        jobIndex= index;
        break;
      }else if(!job.allocatedThreadId && !nextJob){ // if job isnt assigned to speciifc thread
        nextJob= job;
        jobIndex= index;
      }
    }

    if(threadSpecificJob||nextJob){
      WORKER_JOB_QUEUE.splice(jobIndex, 1);
      const job= threadSpecificJob ? threadSpecificJob : nextJob;
      const { command, commandArgs }= job;
      changeWorkerStatus(threadId, workerStatusEnum.busy);
      messageWorker(WORKER_MAP[threadId].worker, command, commandArgs);
    }
}

function WorkerJob(
  command,
  commandArgs,
  allocatedThreadId
){
  this.command= command, 
  this.commandArgs= commandArgs
  this.allocatedThreadId= allocatedThreadId
}

function WorkerObj(
  status,
  worker
){
  this.status= status, 
  this.worker= worker
}

function ConnectSubArg(
  clusterUrl,
  emitterId,
  clientId,
  query,
  connectionParams,
  ws,
  reqType
){
  this.clusterUrl= clusterUrl, 
  this.emitterId= emitterId
  this.clientId= clientId
  this.query= query
  this.connectionParams= connectionParams
  this.ws= ws
  this.reqType= reqType
}
function ConnectQueryArg(
  queryCallbacks,
  connectionParams,
  query,
  reqType
){
  this.queryCallbacks= queryCallbacks, 
  this.connectionParams= connectionParams, 
  this.query= query, 
  this.reqType= reqType
}

// WAIT FOR WORKER TO CONFIRM SERVER BUILD
const addConnectionToConnectQueue = (
  reqType,
  clusterUrl,
  connectionParams,
  emitterId,
  clientId,
  query,
  queryCallbacks,
  ws
) => {

  // Store http req callback to be called when server gen starts
  if(reqType == requestTypeEnum.query){
    const connectQuery = new ConnectQueryArg(queryCallbacks, connectionParams, query, requestTypeEnum.query)
    connectClientQueue[clusterUrl] ? 
      connectClientQueue[clusterUrl].push(connectQuery) :
      connectClientQueue[clusterUrl]= [connectQuery]
  }
  
  // store subscription data to be transfered
  // to connectQueue when server gen starts
  else if(reqType === requestTypeEnum.subscribe){
    const newConnectSub = new ConnectSubArg(
      clusterUrl,
      emitterId,
      clientId,
      query,
      connectionParams,
      ws,
      reqType
    )

    connectClientQueue[clusterUrl] ? 
      connectClientQueue[clusterUrl].push(newConnectSub) :
      connectClientQueue[clusterUrl]= [newConnectSub]
  }
  ws&&sendServerGenerationMessage(ws, 'start-generate')

  // console.log('Add to PreConnect', addConnectionToConnectQueue)
}

const onServerGenerateStarted = (workerResponse) => {
  const connectionData = connectClientQueue[clusterUrl];
  if(connectionData){
    connectClientQueue[clusterUrl].status= workerResponse.process_status;
  }

  console.log('onServerGenerateStarted', connectClientQueue)
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
  const subId= connectionParams?.clientSubId;
  if(rougeSocketMap[subId]){
    delete rougeSocketMap[subId];
    return;
  }
  try {
    const emitter = connectSub(
      gqlServerUrl, 
      emitterId, 
      clientId, 
      query, 
      connectionParams,
      pairSubToClient
    );
    emitter.on(emitterId, data => {
      if(ws?.readyState !== 1)
        return;

      ws?.send(JSON.stringify(data))
    });
  } catch (error) {
    console.log('Emit Error', error)
  }

}

const onServerGenerated = (clusterUrl, serverUrl, threadId, port) => {

  // cache server 
  serverCache.cacheServer(
    threadId,
    clusterUrl,
    serverUrl,
    port
  );

  //remove cluster from current gen cluster
  let newCurrentGenCluster = currentGeneratingServers.filter((cluster) => {
    return cluster !== clusterUrl
  });
  currentGeneratingServers= newCurrentGenCluster;

  // pair internal server with worker
  pairNewServerToWorker(threadId, clusterUrl, serverUrl);

  // connect waiting sockets
  connectWaitingSockets(clusterUrl, serverUrl);

  //remove connectClientQueue data
  connectClientQueue?.[clusterUrl]&& delete connectClientQueue[clusterUrl];

  // reset worker status
  changeWorkerStatus(threadId, workerStatusEnum.idle);


  
}

const removeClusterUrlFromServerMap = (threadId, clusterUrl) => {
  let mapRef= worker_servers_map[threadId];
  worker_servers_map[threadId] = mapRef.filter((clstrUrl) =>  clstrUrl !== clusterUrl)
}

const onInternalServerDestroyed = (clusterUrl, threadId) => {

  // remove and set server cache
  serverCache.onServerDestroy(clusterUrl);

  // update worker server map
  removeClusterUrlFromServerMap(threadId, clusterUrl)

  // reset worker status
  changeWorkerStatus(threadId, workerStatusEnum.idle);
}

// CONNECTS SOCKETS THAT ARE WAITING ON GQL SERVER TO BE GENERATED
const connectWaitingSockets = (clusterUrl, serverUrl) => {
  if(connectClientQueue[clusterUrl]){
    for(let connectionData of connectClientQueue[clusterUrl]){
      const { emitterId, clientId, query, connectionParams, ws, reqType, queryCallbacks } = connectionData;
      const subId= connectionParams?.clientSubId;
      console.log('check', subId)
      if(rougeSocketMap[subId]){
        delete rougeSocketMap[subId];
        continue;
      }
      if(reqType === requestTypeEnum.subscribe){
        console.log('connectWaitingSockets',connectionParams.clientSubId);
        sendServerGenerationMessage(ws, 'end-generate')
        setupSub(serverUrl, emitterId, clientId, query, connectionParams, ws);
      }

      else if(reqType === requestTypeEnum.query){
        // queryServer: async(gqlServerUrl, connectionParams, query) 
        queryCallbacks.queryServer(serverUrl, connectionParams, query)
      }


    }
    delete connectClientQueue[clusterUrl]
  }
}





const messageWorker = (_worker, command, commandArgs) => {
  // console.log('Messaging worker!')
  _worker.postMessage({command, commandArgs})
}

const changeWorkerStatus = (threadId, status) => {
  WORKER_MAP[threadId].status= status;
}

const pairNewServerToWorker = (threadId, clusterUrl, serverUrl) => {
  if(worker_servers_map[threadId]?.includes(clusterUrl))
    return;

  worker_servers_map[threadId]= [...worker_servers_map[threadId]||[], clusterUrl];
  clusterUrl_serverUrl_map[clusterUrl]= serverUrl;
}

const createWorker = () => {
  try {
    const worker = new Worker('./src/serverWorker.js', {
      workerData: {
        command: 'init',
      }
    });
    worker.on('message', async(msg) => {
      const {process_status, process, processDetails, server_uri } = msg;
      if(process_status === workerProcessStatusEnum.complete){
        if(process === workerProcesseesEnum.gen_server){
          const clusterUrl= processDetails;
          // handle waiting connections
          // process cache
          onServerGenerated(
            processDetails.clusterUrl, 
            processDetails.serverUrl,
            worker.threadId,
            processDetails.port,
          )
        }
        else if(process === workerProcesseesEnum.destroy_server){
          const { clusterUrl, success }= processDetails;
          onInternalServerDestroyed(clusterUrl, worker.threadId)
        }
        else if(process === workerProcesseesEnum.init){
          const { clusterUrl, success }= processDetails;
          // onInternalServerDestroyed(clusterUrl, worker.threadId)
        }
        // get next worker job if any
        onFetchWorkerJob(worker.threadId);
      }
      else if(process_status === workerProcessStatusEnum.running){
        if(
          process === workerProcesseesEnum.gen_server&&
          pre_connectClientQueue?.[processDetails]
        ){
          // set status on cluster object to "gen_server"
          // ## we could also message all waiting clients about this?
          onServerGenerateStarted(processDetails);

        }
      }

    });
    worker.on('error', (code) => {
      throw `Worker stopped with exit code ${code}`
    });
    worker.on('exit', (code) => {
      if (code !== 0)
        throw `Worker stopped with exit code ${code}`;
    });

    const threadId= worker.threadId;
    worker_servers_map={
      ...worker_servers_map,
      [threadId]: []
    }
    WORKER_MAP[threadId]= {
        status: workerStatusEnum.idle,
        worker: worker
    }

    return worker;
  } catch (error) {
    console.log('worker error', error)
  }
};


const versionJSON = nodeFs.readFileSync(path.join(__dirname, '../public/health.json')).toString();
app.get('/health', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(versionJSON);
});

// BASE SERVER STARTUP
const serverStart = async() => {
  // Create server gen worker
  await createWorker();

  // console.log('WORKER_MAP', WORKER_MAP)
  let PORT = `${process.env.SERVER_PORT}`;
  if (!process.env.SERVER_PORT) {
    PORT = 8080;
  }
  wsServer.on('request', app);
  wsServer.listen(PORT, () => {
    console.log(` Ws server Listening on port ${wsServer.address().port} 🚀🚀🚀`)
  }) 
};


serverStart();

