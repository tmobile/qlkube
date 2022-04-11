const Crypto = require('crypto');
var events = require('events');
const { createClient } = require('graphql-ws');
const ws = require('ws'); // yarn add ws
const { PubSub } = require('apollo-server-express');
const WebSocketServer  = require('ws').Server; // yarn add ws
const { useServer }  = require('graphql-ws/lib/use/ws');


const generateServer = async(port, schema) => {
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
    return {
      server : wsserver,
      serverUrl: serverUrl,
      port
    };
  }
}


  exports.generateServer = generateServer;
