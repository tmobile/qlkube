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

exports.WorkerJob = WorkerJob;
exports.WorkerObj = WorkerObj;
exports.ConnectSubArg = ConnectSubArg;
exports.ConnectQueryArg = ConnectQueryArg;
