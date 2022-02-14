const gqlPortRange={
    max:1111,
    min:1111
}

var serverCache = module.exports ={
    portQueue:[...Array.from(Array(gqlPortRange.max - gqlPortRange.min + 1).keys()).map(x => x + gqlPortRange.min)],
    usedPorts:[],
    servers:{},
    getPort: function() { 
      if(this.portQueue?.length > 0){
        return this.portQueue[0];
      }
    },
    movePortUsed: function(portNumber) {
      if(this.portQueue?.length > 0){
        const newUnusedPorts= this.portQueue.filter((portNo) => portNo !== portNumber );
        this.portQueue= newUnusedPorts;
        this.usedPorts.push(portNumber);
      }
    },
    addPort: function(prtNmb) {
      this.queue.push(prtNmb)
    },
    getServer: function(clusterUrl) {
      return this.servers?.[clusterUrl]
    },
    recycleServer: async function() {
      let minUsedServer;
      for(let clusterUrl of Object.keys(this.servers)){
        const { lastUsed }= this.servers[clusterUrl];
        if(!minUsedServer){
          minUsedServer= clusterUrl
        }else if(new Date(this.servers[minUsedServer].lastUsed) > new Date(lastUsed)){
          minUsedServer= clusterUrl;
        }
      }
      //kill server port
      await this.destroyServer(this.servers[minUsedServer].serverObj);
      for(let clusterUrl of Object.keys(this.servers)){
        const focusedPort= this.servers[clusterUrl]?.port;
        if(this.servers?.[clusterUrl]?.port === this.servers?.[minUsedServer]?.port){
          const filteredUsedPorts= this.usedPorts.filter((_port) =>  focusedPort!== _port);
          this.usedPorts= filteredUsedPorts;
          delete this.servers[clusterUrl];
          this.portQueue.push(focusedPort);
          break;
        }
      }
      console.log('Server Closed!')
  
    },
    cacheServer: function(clientObj, clusterUrl, serverUrl, port, serverObj) {
      const newServer= {
        gqlServerUrl: serverUrl,
        lastUsed: new Date().toUTCString(),
        clusterUrl,
        port,
        serverObj
      }
      this.servers[clusterUrl]= newServer;
      console.log('New Cached Server', port, clusterUrl);
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