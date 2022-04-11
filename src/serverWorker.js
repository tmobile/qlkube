const { logger } = require('./log');
const {
  isMainThread, 
  parentPort, 
  workerData
} = require('worker_threads');
const { 
  generateDereferencedOas
} = require('./oas');
const { 
  workerProcesseesEnum, 
  workerCommandEnum, 
  workerProcessStatusEnum 
} = require('./enum/workerEnum');


const onGenerateCommand = async(port, kubeApiUrl, schemaToken) => {
  if(port&&kubeApiUrl&&schemaToken){
    // tell main server is generating
    parentPort.postMessage({
      process_status: workerProcessStatusEnum.running,
      process: workerProcesseesEnum.gen_schema,
      processDetails: kubeApiUrl
    });
    // ## Depreciated
    const { derefSpec, subs, error=null }= await generateDereferencedOas(kubeApiUrl, schemaToken);
    console.log('error', error)
    if(!error){
      // tell main generation is complete
      parentPort.postMessage({
        process_status: workerProcessStatusEnum.complete,
        process: workerProcesseesEnum.gen_schema,
        processDetails: {
          clusterUrl: kubeApiUrl,
          port: port,
          dereferencedSpec:derefSpec,
          subscriptionData: subs
        }
      });
    }else if(error){
      parentPort.postMessage({
        process_status: workerProcessStatusEnum.failed,
        process: workerProcesseesEnum.gen_schema,
        processDetails: {
          clusterUrl: kubeApiUrl,
          port
        }
      });
    }
  }
}


const commandHandler = async (message) => {
  const { command, commandArgs }= message;
  const { port, kubeApiUrl, schemaToken } = commandArgs;

  switch(command){
    case workerCommandEnum.generate : {
        onGenerateCommand(port, kubeApiUrl, schemaToken)
      break;
    }
    default: {
      logger.error('cmon meng')
    }
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
    }, 25000) 
  }
}