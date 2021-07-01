let chai = require('chai'); 
const {
    createSchema,
    getWatchables,
    deleteDeprecatedWatchPaths,
    deleteWatchParameters,
    injectUrl,
    hasWatchExp
} = require('../src/schema');
const utilities = require('../src/utilities');
const openApiJSON = require('./openpispec.json')
const fs = require('fs').promises;
require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

describe('functions in schema.js', () => {
    let kubeApiUrl= 'https://kubernetes.default.svc';
    let oasRaw;
    let oasWatchable;
    let subs;
    let oas;
    let graphQlSchemaMap;
    let mappedK8Paths;

    before( async () => {
        oasRaw = openApiJSON
    })

    it('should use path parameters to form path url', async() => {
        const testPath = [ '', 'api', 'v1', 'namespaces', '{namespace}', 'pods', '{name}' ];
        const testNamespace= 'css-dev-duck-dev-w2';
        const testUrlInjectResponse= injectUrl(testPath, testNamespace);
        chai.assert.notEqual(testUrlInjectResponse, '', 'url was not formed');
    });

    it('should filter depreciated watch paths', async() => {
        oasWatchable = deleteDeprecatedWatchPaths(oasRaw);
        const filteredPathCount = Object.keys(oasWatchable['paths']).length;
        const fullPathCount = Object.keys(oasRaw['paths']).length;
        chai.assert.isBelow(filteredPathCount, fullPathCount, 'oasWatchable paths has less paths than oasRaw')
    })

    it('should get watchable paths, namespaced watch paths and non namespaced watch paths', async() => {
        subs = await getWatchables(oasWatchable);
        chai.assert.isArray(subs['watchPaths'])
        chai.assert.isObject(subs['mappedWatchPath'])
        chai.assert.isObject(subs['mappedNamespacedPaths'])
    })

    it('should remove watch from parameters', () => {
        oas = deleteWatchParameters(oasWatchable);
        let hasWatch= false;
        for (const pathName in oas.paths) {
            const path = oas.paths[pathName];
            hasWatch = hasWatchExp(path);
            if(hasWatch){
                break
            }
        }
        chai.assert.isFalse(hasWatch)
    })

    it('should map all paths to their schema types', async() => {
        graphQlSchemaMap = await utilities.mapGraphQlDefaultPaths(oas);
        let schemaMapCount = Object.keys(graphQlSchemaMap).length;
        chai.assert.isObject(graphQlSchemaMap);
        chai.assert.isAbove(schemaMapCount, 0);
    })

    it('should return array of objects that include data for each path', () => {
        const k8PathKeys = Object.keys(oas.paths);
        mappedK8Paths = utilities.mapK8ApiPaths(
            oas,
            k8PathKeys,
            graphQlSchemaMap
        );

        chai.assert.isArray(mappedK8Paths);
        chai.assert.exists(mappedK8Paths[0]['k8sUrl'])
        chai.assert.exists(mappedK8Paths[0]['k8sType'])
        chai.assert.exists(mappedK8Paths[0]['schemaType'])
    })

    it('should generate gql schema', async() => {

        const schema = await createSchema(
            oas,
            kubeApiUrl,
            mappedK8Paths,
            subs.mappedWatchPath,
            subs.mappedNamespacedPaths
        );
        chai.assert.equal(typeof(schema), 'object')
    })
})
