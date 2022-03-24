
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
const { PubSub } = require('apollo-server-express');

const SwaggerParser = require("@apidevtools/swagger-parser");
let parser = new SwaggerParser();
const openapjson = require('../oas.json')
const express = require('express');
const { graphqlHTTP } = require('express-graphql');
const { workerProcesseesEnum, workerCommandEnum } = require('./enum/workerEnum')

const app = express();
let lol=0
let internalServerReference= {};
let clusterUrl_ServerUrl_map= {};
const pubsub = new PubSub();

const SwaggerClient = require('swagger-client')


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
const generateClusterSchema = async(kubeApiUrl, schemaToken) => {
  try {
    logger.debug('Generating cluster schema', kubeApiUrl)
    const authTokenSplit = schemaToken.split(' ');
    const token = authTokenSplit[authTokenSplit.length - 1];
    const oasRaw = await getOpenApiSpec(kubeApiUrl, token);
    const oasWatchable = deleteDeprecatedWatchPaths(oasRaw);
    const subs = await getWatchables(oasWatchable);
    const oas = deleteWatchParameters(oasWatchable);
    // const check = await SwaggerClient.resolve({ spec: oasRaw });

    console.log('Create Schema')
    const schema = await createSchema(
      oas,
      kubeApiUrl,
      subs.mappedWatchPath,
      subs.mappedNamespacedPaths,
    ); // takes the longest
    console.log('Generate Schema 7')

    return schema
  } catch (error) {
    console.log('worker schema gen error' + error)
  }


}

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


const workerProcessStatusEnum = {
  complete: 'complete',
  running: 'running',
  failed: 'failed'
}

const commandHandler = async (message) => {
  const { command, commandArgs }= message;
  const { port, kubeApiUrl, schemaToken } = commandArgs;
  if(command === workerCommandEnum.destroyInternalServer){
    const destroyRes= await destroyInternalServer(kubeApiUrl);
    parentPort.postMessage({
      process_status: workerProcessStatusEnum.complete,
      process: workerProcesseesEnum.destroy_server,
      processDetails: {clusterUrl: kubeApiUrl, success: destroyRes}
    });
  }
  else if(command === workerCommandEnum.generate){
    if(port&&kubeApiUrl&&schemaToken){
      // tell main server is generatinh
      parentPort.postMessage({
        process_status: workerProcessStatusEnum.running,
        process: workerProcesseesEnum.gen_server,
        processDetails: kubeApiUrl
      });
      const schema= await generateClusterSchema(kubeApiUrl, schemaToken)
      if(schema){
        const serverDetails = await generateGqlServer2(port, schema);
        console.log('GEN NEW SERVER COMPLETE++++++111111', kubeApiUrl);

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
    console.log('Worker has started 💥');
    parentPort.postMessage({
      process_status: workerProcessStatusEnum.complete,
      process: workerProcesseesEnum.init,
      processDetails: {}
    });
    setInterval(() => {

      console.log('WORKER_MEM_USAGE', process.memoryUsage().heapTotal/1000000)
      checkServerConnections()
    }, 5000) 

  }

  // if(port&&kubeApiUrl&&schemaToken){
  //   generateClusterSchema(kubeApiUrl, schemaToken)
  //     .then(async(_data) => {
  //       const { 
  //         schema
  //       } = _data;
  //       const graphqlSchemaObj = introspectionFromSchema(schema);

  //       const serverDetails = await generateGqlServer2(9090, schema);
  //       internalServerReference= serverDetails.server

  //       parentPort.postMessage({
  //         process: 'server-gen',
  //         server_uri:serverDetails.server_uri,
  //       });


  //     }).catch((err) => console.log('error', err))

  // }

}



// if (isMainThread) {
//   console.log('brah')
// } else {
//   console.log(workerData?.port);
//   // console.log('cache check :D', cache.get('test'));
//   const { port, kubeApiUrl, schemaToken }= workerData;
//   // console.log(port, kubeApiUrl, schemaToken);

//   if(port&&kubeApiUrl&&schemaToken){
//     console.log('gettit')
//     generateClusterSchema(kubeApiUrl, schemaToken)
//       .then(async(_data) => {
//         const { 
//           schema, 
//           mappedK8Paths,
//           mappedWatchPath,
//           mappedNamespacedPaths,
//           paths,
//           operations,
//           definitions,
//           data
//         } = _data;
//         console.log(
//           '_data',
//           Object.keys(schema),
//         )

//         const queryTypes = schema._queryType._fields;
//         const mutationTypes = schema._mutationType._fields;
//         const subscriptionTypes = schema._subscriptionType._fields;
//         console.log(
//           Object.keys(queryTypes),
//           queryTypes['ioK8sApiCoreV1PodList']
//         )

//         const getCircularReplacer = () => {
//           const seen = new WeakSet();
//           return (key, value) => {
//               if (typeof value === "object" && value !== null) {
//               if (seen.has(value)) {
//                   return;
//               }
//               seen.add(value);
//               }
//               return value;
//           };
//         };
//         const str_defs = JSON.stringify(data.defs, getCircularReplacer());
//         const str_oas = JSON.stringify(data.oass);
//         const strfd = JSON.stringify(data, getCircularReplacer());
//         let defGqlHydrateRefMap= {};

//         let gqllistmap_test={};
//         let gqlObject_test={};

//         let objRepeat={};
//         let listRepeat={};

//         let objNameMap_test=[];
//         // try {
//           // for(let defObj of data.defs){

//         // } catch (error) {
          
//         // }

//         // const test = JSON.parse(str_defs)
//         const test = data.defs[0]?.graphQLType?.getFields();
//         const OBJ_NAME = data.defs[1]?.graphQLType?.constructor?.name;
//         const  check = typeof data.defs[0].graphQLType
//         const funcCheck = typeof data.defs[0]?.graphQLType?.getFields
//         for(let defObj of data.defs){

//           //check if object or list


//           if(defObj?.graphQLType){
//             // if(
//             //   data.defs[i]?.graphQLType?.constructor.name === 'GraphQLObjectType' &&
//             //   typeof data.defs[i]?.graphQLType?.getFields !== 'function'
//             // ){
//             //   objNameMap_test['GraphQLList']=data.defs[i];
//             // }else{
//             //   objNameMap_test[data.defs[i]?.graphQLType?.constructor.name]=data.defs[i];

//             // }
//             objNameMap_test[defObj?.graphQLType?.constructor?.name]=defObj;
//                             // data.defs[1]?.graphQLType?.constructor?.name
//             // if(defObj?.graphQLType?.description){
//             //   //object
//             //   if(gqlObject_test[defObj.preferredName]){
//             //     console.log("Object - Duplicate", defObj.preferredName);
//             //     objRepeat[defObj.preferredName] = defObj
//             //   }
//             //   gqlObject_test[defObj.preferredName]= defObj

//             // }
            
//             // else{
//             //   //list
//             //   if(gqllistmap_test[defObj.preferredName]){
//             //     console.log("List - Duplicate", defObj.preferredName);
//             //     listRepeat[defObj.preferredName] = defObj

//             //   }
//             //   gqllistmap_test[defObj.preferredName]= defObj

//             // } 
//             // const  check = typeof defObj.graphQLType
//             // console.log(typeof defObj.graphQLType)
//             // data.defs[0]?.graphQLType?.constructor?.name
//           }
//           // let preDef= { ...defObj }
//           // if(preDef?.graphQLType){
//           //   preDef.graphQLType=null;
//           //   const hydrateReference= defObj.defs[0]?.graphQLType.getFields();
//           // }

//           // newDefs.push();

//         }
//         //HYDRATION
//         //Preprocess operations -> map of operationId to Path
//         //


//         //oas -> definitions -> ioK8sApiCoreV1PodList is made up of each string seprated by . put to gether
//         // console.log(
//         //   'data',
//         //   schema._typeMap,
//         // )
//         // type map

//         // const graphqlSchemaObj = introspectionFromSchema(schema);
//         // const strigSchema = JSON.stringify(_schema);
//         // const backTo = JSON.parse(strigSchema);
//         // const origSchema = printSchema(_schema);
//         // const hmmm = buildSchema(origSchema);
        
//         // const origSchema = printSchema(buildClientSchema(introspectionFromSchema(buildSchema(strigSchema))))
//         // const origSchema = printSchema(buildClientSchema(introspectionFromSchema(buildSchema(strigSchema))))
//         // console.log(Object.keys(graphqlSchemaObj))



//         // console.log(Object.keys(graphqlSchemaObj))
//         // console.log(graphqlSchemaObj?.__schema.types[50])



//         // console.log(graphqlSchemaObj?.__schema?.queryType?.name)

//         // parentPort.postMessage(origSchema);
//         // const graphqlSchemaObj = buildSchema(introspectionFromSchema(_schema));


//         // const typeDefs = printSchema(_schema);
//         // const schemaIntrospection = await introspectionFromSchema(schema);
//         // const schemaIntrospection = await printIntrospectionSchema(schema);
//         // // const schemaDef = schemaIntrospection.__schema.types;
//         // console.log('schemaDef', schemaDef)
//         // parentPort.postMessage({
//         //   schemaIntrospection,
//         //   subscriptions,
//         //   watchableNonNamespacePaths,
//         //   mappedNamespacedPaths 
//         // });

//         parentPort.postMessage({
//           mappedK8Paths,
//           mappedWatchPath,
//           mappedNamespacedPaths,
//           finalOas: strfd,
//           str_oas:str_oas
//         });


//       }).catch((err) => console.log('error', err))

//   }

// }

// if (isMainThread) {
//   console.log('brah')
// } else {
//   console.log(workerData?.port);
//   console.log('cache check :D', cache.get('test'), lol++);
//         // console.log(_schema)
//         // const graphqlSchemaObj = introspectionFromSchema(_schema);
//         // const strigSchema = JSON.stringify(_schema);
//         // const backTo = JSON.parse(strigSchema);
//         // const origSchema = printSchema(_schema);
//         // const hmmm = buildSchema(origSchema);
        
//         // const origSchema = printSchema(buildClientSchema(introspectionFromSchema(buildSchema(strigSchema))))
//         // const origSchema = printSchema(buildClientSchema(introspectionFromSchema(buildSchema(strigSchema))))
//         // console.log(hmmm)

//         // parentPort.postMessage(origSchema);
//         // const graphqlSchemaObj = buildSchema(introspectionFromSchema(_schema));


//         // const typeDefs = printSchema(_schema);



// }



// const subscriptionType = new GraphQLObjectType({
//   name: 'Subscription',
//   fields, -> introspection
// });

// const schema = new GraphQLSchema({
//   query: queryType,
//   subscription: subscriptionType,
// });

// fields[ObjectEventName] = {
//   type: ObjectEventType, -> introspection.__schema.types[n].fileds[0].name
//   args: customSubArgs[k8sType] ?  introspection.__schema.types[n].fileds[0].args
//     {
//       ...customSubArgs[k8sType]
//     } :
//     {
//       namespace: { type: GraphQLString },
//     },
//   resolve: (payload) => payload, -> smae as here?
//   subscribe: newSubscription,  -> newSub function
// };

//get list of subscriptions
//iterate through insterpscetiont types
// if is sub 