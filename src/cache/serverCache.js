const gqlPortRange={
    max:1160,
    min:1115
}

function ServerObject(
  gqlServerUrl,
  lastUsed,
  clusterUrl,
  port,
  server
){
  this.gqlServerUrl= gqlServerUrl, 
  this.lastUsed= lastUsed
  this.clusterUrl= clusterUrl
  this.port= port
  this.server= server
}

const serverCache = module.exports ={
    portQueue:[...Array.from(Array(gqlPortRange.max - gqlPortRange.min + 1).keys()).map(x => x + gqlPortRange.min)],
    usedPorts:{},
    pendingPorts:{}, // port -> clusterurl :: servers are generating using these ports
    servers:{}, // clusterUrl -> server data, ie threadid, serverUrl etc..
    cacheServer: function(server, clusterUrl, serverUrl, port) {
      const newServer= new ServerObject(
        serverUrl,
        new Date().toUTCString(),
        clusterUrl,
        port,
        server
      )
      this.servers[clusterUrl]= newServer;
      this.movePortUsed(port)
    },
    getServer: function(clusterUrl) {
      return this.servers?.[clusterUrl]
    },
    movePortQueueToPending: function(portNo, clusterUrl) {
      if(this.portQueue?.length > 0){
        const newPortQueue= this.portQueue.filter((freePort) => freePort !== portNo );
        this.portQueue= newPortQueue;
        this.pendingPorts[portNo]= clusterUrl;
      }
    },
    movePortUsedToPending: function(portNo, clusterUrl){
      if(this.usedPorts[portNo]){
        delete this.usedPorts[portNo];
        this.pendingPorts[portNo]= clusterUrl;
      }
    },
    movePortUsed: function(portNo) {
      if(this.pendingPorts?.[portNo]){
        const portDataReference= this.pendingPorts[portNo]
        delete this.pendingPorts[portNo];
        this.usedPorts[portNo]= portDataReference;
      }
    },
    moveUsedPortToQueue: function(portNo) {
      if(this.usedPorts[portNo]){
        delete this.usedPorts[portNo];
        this.portQueue.push(portNo);
      }
    },
    movePendingPortToQueue: function(portNo) {
      if(this.pendingPorts[portNo]){
        delete this.pendingPorts[portNo];
        this.portQueue.push(portNo);
      }
    },
    getUnusedPort: function() { 
      if(this.portQueue?.length > 0){
        return this.portQueue[0];
      }
    },
    getMinUsedServer: function() {
      let minUsedServer;
      for(let clusterUrl of Object.keys(this.servers)){
        const { lastUsed, port }= this.servers[clusterUrl];
        if(this.pendingPorts[port]) continue;
        else if(!minUsedServer){
          minUsedServer= clusterUrl
        }else if(new Date(this.servers[minUsedServer].lastUsed) > new Date(lastUsed)){
          minUsedServer= clusterUrl;
        }
      }
      const leastUsedInternalServer= this.servers[minUsedServer];
      const diffMs = (new Date(leastUsedInternalServer?.lastUsed) - new Date())*-1;
      var diffMins = Math.round(((diffMs % 86400000) % 3600000) / 60000); // minutes
      return { serverData: this.servers[minUsedServer], timeDiff_minutes: diffMins };
    },
    refreshServerUsage: function(serverkey) {
        const refreshedServerData= {
            ...this.servers?.[serverkey],
            lastUsed: new Date().toUTCString()
        }
        this.servers[serverkey]= refreshedServerData;
    },



    onServerDestroy: async function(clusterUrl) {
      const serverReference= this.servers[clusterUrl];
      if(serverReference){
        const { port }= serverReference;
        //removed used port
        //add port queue
        this.moveUsedPortToQueue(port);
        //delete server
        delete this.servers[clusterUrl]
      }
    },
    destroyServer: (serverObject) => {
      serverObject.close()
      serverObject.clients.forEach((socket) => {
        socket.close()
      })
      serverObject.close(() => {
        return true
      })
    }
  }