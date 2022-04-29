const express = require('express');
const { graphqlHTTP } = require('express-graphql');
const { 
    GraphQLString, 
    GraphQLBoolean, 
    GraphQLInt, 
    GraphQLFloat,
    GraphQLSchema, 
    GraphQLObjectType, 
    GraphQLList, 
} = require('graphql');
const { GraphQLJSON } = require('graphql-type-json');
const SwaggerClient = require('swagger-client')
const { getK8SCustomResolver } = require('../resolver/customresolver');
const { isMutation } = require('../enum/schemaProcessEnum');
const {
    createSchema_Trial
} = require('../schema');
const { printColor } = require('./consoleColorLogger')

// ## any of can be multiple schemas
// ## all of generate new schema

// incrimented and used when
// def dosent have schema name
let noRefCount= 0;

const customSchema = {
    '/api/v1/namespaces/{namespace}/pods/{name}/log' : 'PodLogs'
}

const getTypeName = (refField, field) => {
    if(refField){
        const itemRef= refField;
        const rawName= itemRef.split('/').slice(-1).pop();
        const finalName = rawName.replaceAll(/[.-]/g, '');
        return finalName;
    }else{
        // ## look into :: better naming
        // if no schema name, slap a number 
        // on the end of field name
        return `${field}${noRefCount++}`
    }
}

const getSchemaName = (refSchema) => {
    const rawName= refSchema.split('/').slice(-1).pop();
    return rawName.replaceAll(/[.-]/g, '');
}

const sanitizeField = (fieldName) => {
    return fieldName.replaceAll(/[$-]/g, '')
}

const getParameterItem = (type) => {
    switch(type){
        case 'string' : {
            return GraphQLString
        }
        case 'object' : {
            return GraphQLJSON
        }
        case 'boolean' : {
            return GraphQLBoolean
        }
        case 'float' : {
            return GraphQLFloat
        }
        case 'integer' : {
            return GraphQLInt
        }
        default : { // ## or null?
            return  GraphQLJSON
        }
    }
}

const getParameterObject = (argumentList) => {
    let gqlFields= {};
    for(let param of argumentList){
        const { type, name, schema }= param;
        if(!type){
            let normalizedName=name;
            if(name === 'body'){
                normalizedName = '_Input'
            }
            gqlFields[normalizedName]={type: GraphQLString};
        }else{
            typeObj = getParameterItem(type)
            gqlFields[name]={
                type: typeObj
            }
        }
    }
    return gqlFields;
}


const processDefinitions = (specDefs) => {

    // used for defs processing rec func
    let stream= [];
    let miniStream= [];

    // map of processed graphQl types from defs
    let gqlObjectMap={};

    const createGqlObj = (typeData, fields) => {
        let gqlFields= {};
        for(let field of fields){
            const fieldType= field?.data?.type;
            let typeObj;
            if(field.type === 'object'&&gqlObjectMap[field.dataRef]){
                typeObj=gqlObjectMap[field.dataRef];
            }else if(field.type === 'list' &&gqlObjectMap[field.dataRef]){
                typeObj= new GraphQLList(gqlObjectMap[field.dataRef]);
            }else {
                switch(fieldType){
                    case 'string' : {
                        typeObj=GraphQLString
                        break
                    }
                    case 'object' : {
                        typeObj=GraphQLJSON
                        break
                    }
                    case 'boolean' : {
                        typeObj=GraphQLBoolean
                        break
                    }
                    case 'float' : {
                        typeObj=GraphQLFloat
                        break
                    }
                    case 'integer' : {
                        typeObj=GraphQLInt
                        break
                    }
                    case 'number' : {
                        typeObj=GraphQLInt
                        break
                    }
                    case 'array' : {
                        const { items }= field.data;
                        const listType= items?.type;
                        if(listType === 'string') typeObj=GraphQLList(GraphQLString);
                        else if(listType === 'object') typeObj=GraphQLList(GraphQLJSON);
                        else if(listType === 'boolean') typeObj=GraphQLList(GraphQLBoolean);
                        else if(listType === 'float') typeObj=GraphQLList(GraphQLFloat);
                        else if(listType === 'integer') typeObj=GraphQLList(GraphQLInt);
                        else typeObj=GraphQLList(GraphQLJSON); // ## unknown array, slap in JSON
                        break;
                    }
                    default : {
                        // ## unknown field type, slap in JSON
                        typeObj=GraphQLJSON
                    }
                }
            }
            gqlFields[field.name]={
                type: typeObj
            }
        }
    
        let newGqlObj;
        if(typeData.type === 'object'){
            newGqlObj = new GraphQLObjectType({
                name: typeData.name,
                fields: gqlFields,
                description: typeData.desc
            });
        }else if (typeData.type === 'list'){
            newGqlObj = new GraphQLList({
                name: typeData.name,
                fields: gqlFields,
                description: typeData.desc
            });
        };
    
        // ## check out overlaps again
        // ## might have overlooked something
        if(gqlObjectMap?.[typeData.name]){}
        else{ 
            gqlObjectMap[typeData.name]= newGqlObj;
            return gqlObjectMap;
        }
    }

    const processType = (fieldData, fieldName, objType) => {
        // takes into account objects and lists
        let typeName;
        let sendItem;
        if(objType==='list'){ 
            typeName = getTypeName(fieldData.items.$$ref, fieldName)
            sendItem = fieldData.items.properties;
        }
        else{ 
            typeName = getTypeName(fieldData.$$ref, fieldName);
            sendItem = fieldData.properties;
        }

        miniStream.push({
            name: fieldName,
            type: objType,
            data: null,
            dataRef: typeName,
            desc: fieldData?.description || null
        });

        if(gqlObjectMap?.[typeName]){}
        else{
            stream.push(miniStream);
            miniStream=[{
                name: typeName,
                type: 'object',
                desc: fieldData?.description || null
            }];
            specExplorer(sendItem)
        }
    }
    
    // recursive funct to process all types
    const specExplorer = (item) => {
        for(const [fieldData, value] of Object.entries(item)){
            const field = sanitizeField(fieldData)
            if(
                (field === 'items'&&value?.items?.properties)||
                value?.items?.properties
            ){
                // list
                processType(value, field, 'list')
            }else if (value?.properties){
                // object
                processType(value, field, 'object')
            }else{
                // scalar
                miniStream.push({name: field, data: value});
            }
        }
        const typeData= miniStream.shift();
        const fields= miniStream;
        createGqlObj(typeData, fields);
        if(stream?.length>0) miniStream=[...stream.pop()];
    }

    // main loop :: go through all derefed spec defs
    // process each using recursive function
    for(const [path, spec] of Object.entries(specDefs)){
        const typeName= path.replaceAll('.', "");
        const typeName2= sanitizeField(typeName) ;
        miniStream=[{
            name: typeName2,
            type: 'object',
            desc:null
        }];
        stream=[];
        if(spec.properties){
            const specProperty= spec.properties;
            specExplorer(specProperty);
        }
    }

    return gqlObjectMap;
}

// process all paths within spec
// using map of graphql types from defs
const processOperations = (specPaths, gqlObjectMap) => {

    let queryFields = {};
    let mutationFields = {};
    let preSubList= [];

    const processOperation = (opType, opData, path) => {
        const { parameters=[], responses, operationId }= opData;
        const okRes= responses['200']?.schema;
        let okResType;

        if(okRes?.$$ref){
            const itemRef= okRes.$$ref;
            const schemaName= getSchemaName(itemRef);
            okResType= gqlObjectMap[schemaName];
        }else if (okRes?.type){
            okResType = getParameterItem(okRes.type);
        }

        if(!okResType) return;

        const fieldType= okResType;
        const fieldParams= getParameterObject(parameters);
        if(isMutation[opType]){
            mutationFields[operationId]= {
                type: fieldType,
                args: fieldParams,
                resolve: getK8SCustomResolver(path, opType)
            }
        }else{
            queryFields[operationId]= {
                type: fieldType,
                args: fieldParams,
                resolve: getK8SCustomResolver(path, opType)
            }
        }
    }

    const processSubscription = (pathUri, pathGetData) => {
        const okRes= pathGetData?.responses?.['200']?.schema
        if(
            pathGetData?.['x-kubernetes-group-version-kind']?.
                ['kind']&&
            (okRes?.$$ref || customSchema[pathUri])
        ){
            const isCustom= customSchema[pathUri];
            const itemRef= isCustom ? customSchema[pathUri] : okRes.$$ref;
            const schemaName= isCustom ? itemRef : getSchemaName(itemRef);
            const k8sType = pathGetData['x-kubernetes-group-version-kind']['kind'];
            const k8sUrl= pathUri;
            const schemaType= isCustom ? schemaName : String(gqlObjectMap[schemaName]);

            if(schemaType === 'undefined') return;
        
            preSubList.push({
                k8sType,
                k8sUrl,
                schemaType
            })
        }
    }

    // main loop
    // go through all paths 
    // process mutations / queries / partial subscriptions
    for(const [path, data] of Object.entries(specPaths)){
        const { get, post, put, patch, delete: del } = data;
        if(get){
            processOperation('get', get, path);
            processSubscription(path, get);
        }
        if(put) processOperation('put', put, path);
        if(del) processOperation('delete', del, path);
        if(post) processOperation('post', post, path);
        if(patch) processOperation('patch', patch, path);
    }
    return {
        queryFields,
        mutationFields,
        preSubList
    }
}


const getSchema = async(
    derefSpec,
    subs
) => {

    try {
        if(!derefSpec)  throw new Error('invalid dereferenced oas');

        const specDefs= derefSpec?.spec?.definitions;
        const specPaths= derefSpec?.spec?.paths;

        if(!(derefSpec&&subs&&specDefs&&specPaths)) throw new Error('schema creation, invalid parameters');
        printColor('yellow', 'Schema Generate Started...')
    
        const gqlObjectMap = processDefinitions(specDefs);
        const {
            queryFields,
            mutationFields,
            preSubList
        } = processOperations(specPaths, gqlObjectMap);
        

        const queryType = new GraphQLObjectType({
            name: 'Query',
            fields: queryFields
        })
        const mutationType = new GraphQLObjectType({
            name: 'Mutations',
            fields: mutationFields
        })
        const baseSchema = new GraphQLSchema({
            query: queryType,
            mutation: mutationType
        });
    
        const schema = createSchema_Trial(
            baseSchema,
            subs.mappedWatchPath,
            subs.mappedNamespacedPaths,
            preSubList
        )
        printColor('green', 'Schema Generation Complete')

        return schema;
    } catch (error) {
        printColor('red', error)
        return {
            error: {
                errorPayload: error
            }
        }
    }
}

const testGetSchema = () => {
    const { lol } = require('../test_spec.js');
    if(!lol?.spec) return;
    getSchema(lol)
}

// test server with graphiql
// using locally saved spec
const testServeGql = async() => {
    const { lol } = require('../test_spec.js');
    if(!lol?.spec) return;
    const schema = await getSchema(lol.spec);
    var app = express();
    app.use('/graphql', graphqlHTTP({
      schema: schema,
      graphiql: true,
    }));
    app.listen(9090);
    console.log('Running a GraphQL API server at http://localhost:9090/graphql');
}

// testGetSchema();
// testServeGql()

exports.getSchema = getSchema;