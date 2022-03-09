
const {
  Worker, isMainThread, parentPort, workerData
} = require('worker_threads');
const WebSocketServer  = require('ws').Server; // yarn add ws
const utilities = require('./utilities');
const getOpenApiSpec = require('./oas');
const {
  createSchema,
  getWatchables,
  deleteDeprecatedWatchPaths,
  deleteWatchParameters,
} = require('./schema');
const { logger } = require('./log');
const { useServer }  = require('graphql-ws/lib/use/ws');
const cache = require('./cache/serverObjCache')();
const v8 = require('v8');
const script = workerData;
const {
  printSchema,
  buildSchema,
  buildClientSchema,
  printIntrospectionSchema,
  introspectionFromSchema,
} = require('graphql');

const SwaggerParser = require("@apidevtools/swagger-parser");
let parser = new SwaggerParser();
const openapjson = require('../oas.json')

let lol=0

// GENERATES CLUSTER SCHEMA FOR NEW SERVERS
const generateClusterSchema = async(kubeApiUrl, schemaToken) => {

    try {
      let api = await SwaggerParser.resolve(openapjson);
      console.log("API name: %s, Version: %s", api._$refs);
    }
    catch(err) {
      console.error(err);
    }
}


generateClusterSchema();