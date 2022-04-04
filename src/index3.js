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
var request = require('request');

const bodyParser = require('body-parser');
var process = require('process')
const serverCache = require('./cache/serverCache');

const { connectSub, connectQuery } = require('./utils/internalServerConnect');
const { workerProcesseesEnum, workerCommandEnum, workerStatusEnum, workerProcessStatusEnum } = require('./enum/workerEnum');
const { requestTypeEnum } = require('./enum/requestEnum');
const { WorkerJob, WorkerObj, ConnectSubArg, ConnectQueryArg } = require('./models/argumentTypes')
//------

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
const inCluster = process.env.IN_CLUSTER !== 'false';
logger.info({ inCluster }, 'cluster mode configured');

const rawConfig= nodeFs.readFileSync(path.join(__dirname, './config/config.json'));
const config= JSON.parse(rawConfig);


let clientInternalWsMap={};
let internalSubObjMap={}
let clientToInternalSubIdMap={};
let rougeSocketMap={};

let currentGeneratingServers= [];
let pre_connectClientQueue= {};
let connectClientQueue= {};

let worker_servers_map= {};
let clusterUrl_serverUrl_map= {};
let WORKER_JOB_QUEUE= [];

const app = express();
app.use(cors());
app.use(bodyParser.json());

let preLoadCount= 0;
let preLoadCurrent= 0;
let preLoadFailed= 0;
let preLoadSuccess= 0;
let isPreloaded= false;

let WORKER_MAP= {};

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise')
  logger.debug('This is probably from a closed websocket');

  // application specific logging, throwing an error, or other logic here
});

// GQL QUERIES
// how to handle...
// 1 return promise that has set interval checking completed servers
// 2 create promis and pass it all the way into connect client queue -> call resolver when server completes
app.get('/gql', async(req, res) => {

  if(req?.headers?.connectionparams){
    const queryParams= JSON.parse(req?.headers?.connectionparams);
    const { query, authorization, clusterUrl }= queryParams;
    // console.log('recieved request', query, clusterUrl);

    const queryCallbacks = {
      isGenerating: () => {
        res.write(JSON.stringify({
          status: 'generating'
        }))
      },
      queryServer: async(gqlServerUrl, connectionParams, query) => {
        const queryResponse= await connectQuery(gqlServerUrl, query, connectionParams, updateServerUsage);
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



// callback to update server last used
const updateServerUsage = (clusterUrl) => {
  // console.log('SERVER USAGE CALLBACK!')
  if(serverCache.getServer(clusterUrl)){
    serverCache.refreshServerUsage(clusterUrl);
  }
}


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
    console.log('DISPOSE - pairSubToClient', clientSubId)
    subObj.dispose();
    delete rougeSocketMap[clientSubId]
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

      // SUBSCRIPTION REQUEST :: CONNECT
      if(requestType === requestTypeEnum.subscribe){
        ws.clientId= clientId;
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
        destroySpeifiedInternalWebsocket(connectionParams.clientSubId, connectionParams.clientId, connectionParams?.clusterUrl);
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
      // logger.debug('Meta websocket closed for', ws.clientId);
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
    logger.error('meta ws error: ' + err );
  })
  ws.onclose = function(evt){
    logger.debug('meta ws closure: ' + evt );
  }
  logger.debug('New meta websocket')
});

// ENDS SPECIFIC INTERNAL SUB FOR CLIENT
const destroySpeifiedInternalWebsocket = (clientSubId, clientId, test) => {
  try {
    const internalSocketId= clientToInternalSubIdMap[clientSubId];
    const internalSubObj = internalSubObjMap[internalSocketId];
    if(internalSubObj){
      internalSubObj?.dispose();
      delete internalSubObjMap[internalSocketId];
      delete clientToInternalSubIdMap[clientSubId];
      if(clientInternalWsMap?.[clientId]){
        const filteredClientInternalWs= clientInternalWsMap[clientId].filter((intsbid) => intsbid !== internalSocketId);
        clientInternalWsMap[clientId]= filteredClientInternalWs;
      }
    }else{
      rougeSocketMap[clientSubId]= clientId;
    }
  } catch (error) {
    logger.error('destroySpeifiedInternalWebsocket error: ' + error);
  }
}

// ENDS ALL CACHED ROUTING DATA FOR CLIENT
const destroyCachedDataForClient = (wsId) => {
  try {
    logger.debug('Internal ws close request from', wsId)
    let internalSubsForClient=[];
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

  } catch (error) {
    console.log('destroyCachedDataForClient ' + error )
  }
}

const checkWorkersForServer = (serverId) => {
  for(let [workerId, servers] of Object.entries(worker_servers_map)){

    if(servers&&servers?.includes(serverId)){
      return {
        gqlServerUrl: clusterUrl_serverUrl_map[serverId],
        workerHandler: workerId,
        isRunning: clusterUrl_serverUrl_map[serverId] ? true: false
      }
    }
  }
  return false;
}

const getIdleWorker = () => {
  for(let [workerId, workerData] of Object.entries(WORKER_MAP)){
    if(workerData.status === workerStatusEnum.idle){
      return workerId
    }
  }
  return false;
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
    if(internalServerUrl?.isRunning){
      const { gqlServerUrl }= internalServerUrl;

      // if sub
      if(requestMode === requestTypeEnum.subscribe){
        ws&&sendServerGenerationMessage(ws, 'end-generate')
        setupSub(gqlServerUrl, emitterId, clientId, query, connectionParams, ws)
      }

      // if query
      if(requestMode === requestTypeEnum.query){
        console.log('Query!')
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
          queryCallbacks,
          internalServerUrl&&!internalServerUrl?.isRunning&&'cache'
        );
      }
  
      // NO FREE PORTS -> RECYCLE SERVER
      else{
        queryCallbacks?.isGenerating()

        recycleServer(
          clusterUrl, 
          token,
          requestMode,
          connectionParams,
          emitterId,
          clientId,
          query,
          ws,
          queryCallbacks,
          internalServerUrl&&!internalServerUrl?.isRunning&&'cache'
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
  queryCallbacks,
  genType
) => {
  // get least used server
  const { serverData:leastUsedInternalServer, timeDiff_minutes }= serverCache.getMinUsedServer();
  console.log('RECYCLE', leastUsedInternalServer, timeDiff_minutes)
  if(leastUsedInternalServer){
    const { threadId, clusterUrl, port: freePort }= leastUsedInternalServer;

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
    serverCache.movePortUsedToPending(freePort, replacementClusterUrl);

    // create job to destroy internal server
    onAddWorkerJob(
      workerCommandEnum.destroyInternalServer,
      {
        kubeApiUrl: clusterUrl
      },
      threadId
    );

    const genFromCache= genType==='cache' ? true : false;

    genFromCache&&genServerFromCacheComm(freePort, replacementClusterUrl);
    !genFromCache&&genServerComm(freePort, replacementClusterUrl, token);
  }
}

const genServerFromCacheComm = (freePort, clusterUrl) => {
  onAddWorkerJob(
    workerCommandEnum.generateCached,
    {
      port: freePort,
      kubeApiUrl: clusterUrl
    }
  )
}

const genServerComm = (freePort, clusterUrl, token) => {
  onAddWorkerJob(
    workerCommandEnum.generate,
    {
      port: freePort,
      kubeApiUrl: clusterUrl,
      schemaToken: token
    }
  )
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
  queryCallback,
  genType
) => {

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
    const genFromCache= genType==='cache' ? true : false;

    genFromCache&&genServerFromCacheComm(freePort, clusterUrl);
    !genFromCache&&genServerComm(freePort, clusterUrl, token);

    queryCallback?.isGenerating()

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

  if(focusedWs?.readyState !== 1)
    return;

  messageType === 'start-generate'&&focusedWs?.send(
    JSON.stringify({ status: 'generating' })
  )
  messageType === 'end-generate'&&focusedWs?.send(
    JSON.stringify({ status: 'exists' })
  )
}

// SETS UP SUBSCRIPTION / EMITTER FOR CLIENT
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
      pairSubToClient,
      updateServerUsage
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

const onPostPreLoad = (threadId, clusterUrl, commStatus) => {

  preLoadCurrent++;
  commStatus&&preLoadSuccess++;
  !commStatus&&preLoadFailed++;

  changeWorkerStatus(threadId, workerStatusEnum.idle);
  commStatus&&pairNewServerToWorker(threadId, clusterUrl, null);
  const preLoadStatus_actual= Math.ceil((preLoadCurrent / preLoadCount)*100) ;
  const preLoadStatus= Math.ceil(((preLoadCurrent / preLoadCount)*100)/ 5) ;
  
  const dots = ".".repeat(preLoadStatus)
  const left = 20 - preLoadStatus
  const empty = " ".repeat(left)

  console.log('\x1b[36m%s\x1b[0m', `\r[${dots}${empty}] ${preLoadStatus_actual}%`)
  if(preLoadCurrent === preLoadCount){
    console.log("\x1b[32m%s\x1b[0m", `Pre loading complete! :: success ${preLoadSuccess} :: failed ${preLoadFailed}`);
    isPreloaded=true;
  }
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
      if(rougeSocketMap[subId]){
        delete rougeSocketMap[subId];
        continue;
      }
      if(reqType === requestTypeEnum.subscribe){
        sendServerGenerationMessage(ws, 'end-generate')
        setupSub(serverUrl, emitterId, clientId, query, connectionParams, ws);
      }
      else if(reqType === requestTypeEnum.query){
        queryCallbacks.queryServer(serverUrl, connectionParams, query)
      }
    }
    delete connectClientQueue[clusterUrl]
  }
}

const messageWorker = (_worker, command, commandArgs) => {
  _worker.postMessage({command, commandArgs})
}

const changeWorkerStatus = (threadId, status) => {
  WORKER_MAP[threadId].status= status;
}

const pairNewServerToWorker = (threadId, clusterUrl, serverUrl) => {

  !worker_servers_map[threadId]?.includes(clusterUrl)&&
    (worker_servers_map[threadId]= [...worker_servers_map[threadId]||[], clusterUrl]);

  // if null serverUrl
  // we interpret that as a "non live" server
  // there is a specific job to handle this
  serverUrl&&(clusterUrl_serverUrl_map[clusterUrl]= serverUrl);
}

const onWorkerStarted = async() => {

  // ## Better solution in future
  const getBasicToken = async() => {
    try {
      console.log(`getBasicToken :: ${process.env.CONDUCKTOR_K8S_ONBOARD_USER}`)
      if(process.env.CONDUCKTOR_K8S_ONBOARD_USER&&process.env.CONDUCKTOR_K8S_ONBOARD_PASSWORD){
        const basicAuthFormat= `${process.env.CONDUCKTOR_K8S_ONBOARD_USER}:${process.env.CONDUCKTOR_K8S_ONBOARD_PASSWORD}`;
        const basicAuthBase64= await Buffer.from(basicAuthFormat).toString('base64');
        var options = {
          method: 'POST',
          url: process.env.AUTH_URL,
          headers: {
            'Authorization': `Basic ${basicAuthBase64}`
          }
        };
        return new Promise((resolve, reject) => {
          request(options, function (error, response) {
            if (error) throw new Error(error);
            const data= JSON.parse(response.body)
            if (!data.jwt) throw new Error('request error');
            resolve(data?.jwt);
          });
        })
      }
    } catch (error) {
      return {
        error: {
          errorPayload: error
        }
      }
    }
  }


  console.log('Worker has started');
  serverStart();

  //check and preload
  if(config?.preLoad){
    const token= await getBasicToken();
    if(!token.error){
      const preLoadList= config.preLoad;
      preLoadCount= preLoadList?.length;
      for(let clusterUrl of config.preLoad){
        onAddWorkerJob(
          workerCommandEnum.preLoad,
          {
            kubeApiUrl: clusterUrl,
            schemaToken: `Bearer ${token}`
          }
        )
      }
    }
  }else{
    console.log('no config')
    isPreloaded=true;
  }
}

const createWorker = () => {
  try {
    const worker = new Worker('./src/serverWorker.js', {
      workerData: {
        command: workerProcesseesEnum.init,
      }
    });
    worker.on('message', async(msg) => {
      const {process_status, process, processDetails, server_uri } = msg;
      if(process_status === workerProcessStatusEnum.complete){
        if(process === workerProcesseesEnum.gen_server){
          const clusterUrl= processDetails;
          // handle waiting connections
          // and update cache
          console.log('return generated')
          onServerGenerated(
            processDetails.clusterUrl, 
            processDetails.serverUrl,
            worker.threadId,
            processDetails.port,
          )
        }
        else if(process === workerProcesseesEnum.destroy_server){
          const { clusterUrl, success }= processDetails;
          console.log('return destroyed')
          onInternalServerDestroyed(clusterUrl, worker.threadId)
        }
        else if(process === workerProcesseesEnum.init){
          const { success }= processDetails;
            // check preload
            onWorkerStarted()
        }
        else if(process === workerProcesseesEnum.preLoad){
          onPostPreLoad(worker.threadId, processDetails.clusterUrl, true);
        }
        // get next worker job if any are in pool
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
      else if(process_status === workerProcessStatusEnum.failed){
        if(process === workerProcesseesEnum.preLoad){
          onPostPreLoad(worker.threadId, processDetails.clusterUrl, false);
        }
        onFetchWorkerJob(worker.threadId);
      }
    });
    worker.on('error', (msg) => {
      throw `Worker stopped with error :: ${msg}`
    });
    worker.on('exit', (code) => {
      if (code !== 0)
        throw `Worker stopped with exit code :: ${code}`;
    });

    const threadId= worker.threadId;
    worker_servers_map={
      ...worker_servers_map,
      [threadId]: []
    }

    WORKER_MAP[threadId]= new WorkerObj(workerStatusEnum.idle, worker)

    return worker;
  } catch (error) {
    console.log('worker error', error)
  }
};

const versionJSON = nodeFs.readFileSync(path.join(__dirname, '../public/health.json')).toString();
app.get('/health', (req, res) => {
  if(isPreloaded){
    res.setHeader('Content-Type', 'application/json');
    res.send(versionJSON);
  }
});

const serverStart = () => {
  let PORT = `${process.env.SERVER_PORT}`;
  if (!process.env.SERVER_PORT) {
    PORT = 8080;
  }
  wsServer.on('request', app);
  wsServer.listen(PORT, () => {
    console.log("\x1b[32m%s\x1b[0m", `Server istening on port ${wsServer.address().port} 🚀🚀🚀`)
  }) 
}

// INIT STARTUP
const initilize = async() => {
  // badass console logo :D
  console.log("\x1b[35m%s\x1b[0m", ` _______ _       _     _ _     _ ______  _______ \r\n(_______|_)     (_)   | (_)   (_|____  \\(_______)\r\n _    _  _       _____| |_     _ ____)  )_____   \r\n| |  | || |     |  _   _) |   | |  __  (|  ___)  \r\n| |__| || |_____| |  \\ \\| |___| | |__)  ) |_____ \r\n \\______)_______)_|   \\_)\\_____\/|______\/|_______)`)
  await createWorker();
};


initilize();

