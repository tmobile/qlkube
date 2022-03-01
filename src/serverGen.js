
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



let lol=0

// GENERATES CLUSTER SCHEMA FOR NEW SERVERS
const generateClusterSchema = async(kubeApiUrl, schemaToken) => {
  return new Promise(async (resolve, reject) => {
    logger.debug('Generating cluster schema', kubeApiUrl)
    const oasRaw = await getOpenApiSpec(kubeApiUrl, schemaToken);
    // console.log('Generate Schema 1')
    const oasWatchable = deleteDeprecatedWatchPaths(oasRaw);
    // console.log('Generate Schema 2')
    const subs = await getWatchables(oasWatchable);
    // console.log('Generate Schema 3')
    const oas = deleteWatchParameters(oasWatchable);
    // console.log('Generate Schema 4')
    const graphQlSchemaMap = await utilities.mapGraphQlDefaultPaths(oas);// takes a while
    // console.log('Generate Schema 5');
    if(graphQlSchemaMap.error){
      // proabably an invalid zuth token
      //## PING MAIN THREAD
      // return graphQlSchemaMap;
    }
    const k8PathKeys = Object.keys(oas.paths);
    const mappedK8Paths = utilities.mapK8ApiPaths(
      oas,
      k8PathKeys,
      graphQlSchemaMap
    );
    console.log('Generate Schema 6')
    const schema = await createSchema(
      oas,
      kubeApiUrl,
      mappedK8Paths,
      subs.mappedWatchPath,
      subs.mappedNamespacedPaths
    ); // takes the longest
    console.log('Generate Schema 7')
    const newData = {
      schema:schema,
      subscriptions:mappedK8Paths,
      watchableNonNamespacePaths:subs.mappedWatchPath,
      mappedNamespacedPaths:subs.mappedNamespacedPaths,
      paths: oas.paths
    }
    resolve(newData);
  })

}



if (isMainThread) {
  console.log('brah')
} else {
  console.log(workerData?.port);
  // console.log('cache check :D', cache.get('test'));
  const { port, kubeApiUrl, schemaToken }= workerData;
  // console.log(port, kubeApiUrl, schemaToken);

  if(port&&kubeApiUrl&&schemaToken){
    console.log('gettit')
    generateClusterSchema(kubeApiUrl, schemaToken)
      .then(async(data) => {
        const { 
          schema, 
          subscriptions, 
          watchableNonNamespacePaths, 
          mappedNamespacedPaths,
          paths
        } = data;
        // console.log(
        //   'data',
        //   Object.keys(schema),
        // )
        // console.log(
        //   'data',
        //   schema._typeMap,
        // )
        // type map

        // const graphqlSchemaObj = introspectionFromSchema(schema);
        // const strigSchema = JSON.stringify(_schema);
        // const backTo = JSON.parse(strigSchema);
        // const origSchema = printSchema(_schema);
        // const hmmm = buildSchema(origSchema);
        
        // const origSchema = printSchema(buildClientSchema(introspectionFromSchema(buildSchema(strigSchema))))
        // const origSchema = printSchema(buildClientSchema(introspectionFromSchema(buildSchema(strigSchema))))
        // console.log(Object.keys(graphqlSchemaObj))



        // console.log(Object.keys(graphqlSchemaObj))
        // console.log(graphqlSchemaObj?.__schema.types[50])



        // console.log(graphqlSchemaObj?.__schema?.queryType?.name)

        // parentPort.postMessage(origSchema);
        // const graphqlSchemaObj = buildSchema(introspectionFromSchema(_schema));


        // const typeDefs = printSchema(_schema);
        const schemaIntrospection = await introspectionFromSchema(schema);
        // const schemaIntrospection = await printIntrospectionSchema(schema);
        // // const schemaDef = schemaIntrospection.__schema.types;
        // console.log('schemaDef', schemaDef)
        // parentPort.postMessage({
        //   schemaIntrospection,
        //   subscriptions,
        //   watchableNonNamespacePaths,
        //   mappedNamespacedPaths 
        // });

        parentPort.postMessage({
          schemaIntrospection,
          subscriptions,
          watchableNonNamespacePaths,
          mappedNamespacedPaths,
          paths
        });


      }).catch((err) => console.log('error', err))

  }

}

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