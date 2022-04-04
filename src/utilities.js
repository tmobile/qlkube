/* eslint-disable */
const Oas3Tools = require('../openapi-to-graphql/lib/oas_3_tools');
const preprocessor_1 = require('../openapi-to-graphql/lib/preprocessor');
const schema_builder_1 = require('../openapi-to-graphql/lib/schema_builder');
const getDefaultGraphQlSchemaOptions = require('../model/schemaDefaultOptions');

async function mapGraphQlDefaultPaths(spec) {
  options = getDefaultGraphQlSchemaOptions();
  return new Promise((resolve, reject) => {
    Oas3Tools.getValidOAS3(spec)
      .then((oas) => {
        resolve(translateOpenAPIToGraphQLREV([oas], options));
      })
      .catch((err) => {
        console.log('err wowwww', err)

        resolve( {
          error:{
            errorPayload:err
          }
        })
      });
  });
}
// ## check if get req has x-kubernetes-group-version-kind ?
// for fields that have this get $$ref and stringify
function mapK8ApiPaths(oas, pathNames, graphQlSchemaMap) {
  return (mappedK8Paths = pathNames
    .map((pathName) => {
      let currentPath = oas['paths'][pathName];
      let currentPathKeys = Object.keys(currentPath);

      if (
        currentPathKeys.length > 0 &&
        oas['paths'][pathName][currentPathKeys[0]][
          'x-kubernetes-group-version-kind'
        ]
      ) {
        let tempK8Type =
          oas['paths'][pathName][currentPathKeys[0]][
            'x-kubernetes-group-version-kind'
          ]['kind'];

        return {
          k8sUrl: pathName,
          k8sType: tempK8Type,
          schemaType: String(graphQlSchemaMap[pathName]),
        };
      } 
      
      else {
        return false;
      }
    })
    .filter((obj) => obj !== false));
}

const translateOpenAPIToGraphQLREV = (data) => {
  console.log('-----')
  let schemaTypeMap = {};

  Object.entries(data.operations).forEach(([operationId, operation]) => {
    // console.log(operation.responseDefinition?.targetGraphQLType)
    const field = schema_builder_1.getGraphQLType({
      def: operation.responseDefinition,
      data,
      operation,
    });
    schemaTypeMap[operation.path] = field;
  });
  return {
    graphQlSchemaMap:schemaTypeMap,
  };
}

exports.mapGraphQlDefaultPaths = mapGraphQlDefaultPaths;
exports.mapK8ApiPaths = mapK8ApiPaths;
exports.translateOpenAPIToGraphQLREV = translateOpenAPIToGraphQLREV;
