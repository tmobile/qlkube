
const {
  isMainThread, 
  parentPort, 
  workerData
} = require('worker_threads');
const { useServer }  = require('graphql-ws/lib/use/ws');
const WebSocketServer  = require('ws').Server; // yarn add ws
const getOpenApiSpec = require('./oas');
const { logger } = require('./log');
const { PubSub } = require('apollo-server-express');
const { printColor } = require('./utils/consoleColorLogger')
const { getSchema } = require('./utils/process-oas')
const { workerProcesseesEnum, workerCommandEnum, workerProcessStatusEnum } = require('./enum/workerEnum')


let internalServerReference= {};
let clusterUrl_ServerUrl_map= {};
let cachedGqlSchemas= {};

const generateGqlServer2 = async(port, schema) => {
  if(!schema||!port){
    return {
      error: {
        errorPayload: 'Invalid server gen arguments'
      }
    };
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
        const pubsub = new PubSub();

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
    const serverUrl= `http://localhost:${port}/gql`;
    internalServerReference[serverUrl]= wsserver;
    return {
      server : wsserver,
      serverUrl: serverUrl,
      port
    };
  }
}

// GENERATES CLUSTER SCHEMA FOR NEW SERVERS
const generateClusterSchema_Replacer = async(kubeApiUrl, schemaToken) => {
  try {
    logger.debug('Generating cluster schema - Custom', kubeApiUrl)
    const authTokenSplit = schemaToken.split(' ');
    const token = authTokenSplit[authTokenSplit.length - 1];
    const oasRaw = await getOpenApiSpec(kubeApiUrl, token);
    const schema = await getSchema(
      oasRaw
    );
    return schema
  } catch (error) {
    printColor('red', `worker schema gen error :: ${error}`)
  }
}

// GENERATES CLUSTER SCHEMA FOR NEW SERVERS :: DEPRECIATED
// const generateClusterSchema = async(kubeApiUrl, schemaToken) => {
//   try {
//     logger.debug('Generating cluster schema', kubeApiUrl)
//     const authTokenSplit = schemaToken.split(' ');
//     const token = authTokenSplit[authTokenSplit.length - 1];
//     const oasRaw = await getOpenApiSpec(kubeApiUrl, token);
//     const oasWatchable = deleteDeprecatedWatchPaths(oasRaw);
//     const subs = await getWatchables(oasWatchable);
//     const oas = deleteWatchParameters(oasWatchable);

//     if(oas?.code || Object.keys(oas)?.length <2){
//       console.log('error...')
//       return {
//         error: {
//           errorPayload: `error retrieving schema`
//         }
//       }
//     } 
//     // const check = await SwaggerClient.resolve({ spec: oasRaw });

//     // console.log('Create Schema', kubeApiUrl)
//     const schema = await createSchema(
//       oas,
//       kubeApiUrl,
//       subs.mappedWatchPath,
//       subs.mappedNamespacedPaths,
//     ); // takes the longest
//     printColor('blue', `Generated Schema :: ${kubeApiUrl}`)

//     return schema
//   } catch (error) {
//     console.log('worker schema gen error' + error)
//   }
// }

const destroyInternalServer = async(clusterUrl) => {
  try {
    const serverUrl= clusterUrl_ServerUrl_map[clusterUrl];
    const serverObject= internalServerReference[serverUrl];
    serverObject.close()
    serverObject.clients.forEach((socket) => {
      socket.close()
    })
    const res = await serverObject.close(() => {
      return true
    });

    return res;
  } catch (error) {
    console.log('Server destroy error', error)
  }

}

const onGenerateCommand = async(port, kubeApiUrl, schemaToken) => {
  if(port&&kubeApiUrl&&schemaToken){
    // tell main server is generatinh
    parentPort.postMessage({
      process_status: workerProcessStatusEnum.running,
      process: workerProcesseesEnum.gen_server,
      processDetails: kubeApiUrl
    });
    // const schema= await generateClusterSchema(kubeApiUrl, schemaToken)
    const schema= await generateClusterSchema_Replacer(kubeApiUrl, schemaToken)
    if(schema){
      const serverDetails = await generateGqlServer2(port, schema);
      printColor('blue', `GEN SERVER COMPLETE  :: ${kubeApiUrl}`)
      const { serverUrl }= serverDetails
      clusterUrl_ServerUrl_map[kubeApiUrl]= serverUrl;
      // tell main generation is complete
      parentPort.postMessage({
        process_status: workerProcessStatusEnum.complete,
        process: workerProcesseesEnum.gen_server,
        processDetails: {
          clusterUrl: kubeApiUrl,
          serverUrl: serverDetails.serverUrl,
          port: serverDetails.port
        }
      });
    }
  }
}

const onDestroyInternalSrvCommand = async(kubeApiUrl) => {
  const destroyRes= await destroyInternalServer(kubeApiUrl);
  parentPort.postMessage({
    process_status: workerProcessStatusEnum.complete,
    process: workerProcesseesEnum.destroy_server,
    processDetails: {clusterUrl: kubeApiUrl, success: destroyRes}
  });
}

const commandHandler = async (message) => {
  const { command, commandArgs }= message;
  const { port, kubeApiUrl, schemaToken } = commandArgs;

  switch(command){
    case workerCommandEnum.destroyInternalServer : {
      onDestroyInternalSrvCommand(kubeApiUrl);
      break
    }
    case workerCommandEnum.generate : {
      onGenerateCommand(port, kubeApiUrl, schemaToken);
      break
    }
    case workerCommandEnum.generateCached : {
      if(cachedGqlSchemas[kubeApiUrl]&&port){
        const cachedSchema= cachedGqlSchemas[kubeApiUrl];
        const serverDetails = await generateGqlServer2(port, cachedSchema);
        console.log("\x1b[34m%s\x1b[0m", `GEN CACHE COMPLETE :: ${kubeApiUrl}`);
        const { serverUrl }= serverDetails
        clusterUrl_ServerUrl_map[kubeApiUrl]= serverUrl;
        parentPort.postMessage({
          process_status: workerProcessStatusEnum.complete,
          process: workerProcesseesEnum.gen_server,
          processDetails: {
            clusterUrl: kubeApiUrl,
            serverUrl: serverDetails.serverUrl,
            port: serverDetails.port
          }
        });
      }else{
        return {
          error: {
            errorPayload: 'invalid cache'
          }
        }
      }
      break
    }
    case workerCommandEnum.preLoad : {
      const schema= await generateClusterSchema(kubeApiUrl, schemaToken);
      if(schema?.error){
        console.log('Preload Failed -- ', kubeApiUrl)
        parentPort.postMessage({
          process_status: workerProcessStatusEnum.failed,
          process: workerProcesseesEnum.preLoad,
          processDetails: {
            clusterUrl: kubeApiUrl,
          }
        });
        return;
      }
      cachedGqlSchemas[kubeApiUrl]= schema;
      parentPort.postMessage({
        process_status: workerProcessStatusEnum.complete,
        process: workerProcesseesEnum.preLoad,
        processDetails: {
          clusterUrl: kubeApiUrl,
        }
      });
      break
    }
    default: {
      logger.error('cmon meng')
    }
  }

}

const checkServerConnections = () => {
  for(let serverUrl of Object.keys(internalServerReference)){
    let socketCount=0;
    internalServerReference[serverUrl].clients?.forEach((socket) => {
      socketCount++;
    });
    // if(socketCount > 0){
    //   serverCache.refreshServerUsage(clusterUrl)
    // }
    console.log('SERVER---', serverUrl, socketCount);
  }
}
if (isMainThread) {} 
else {

  parentPort.on("message", async (message) => {
    commandHandler(message);
  });

  const { command: initCommand }= workerData;
  if(initCommand === workerCommandEnum.init){
    parentPort.postMessage({
      process_status: workerProcessStatusEnum.complete,
      process: workerProcesseesEnum.init,
      processDetails: {}
    });
    setInterval(() => {

      console.log('WORKER_MEM_USAGE', process.memoryUsage().heapTotal/1000000)
      checkServerConnections()
    }, 25000) 

  }
}