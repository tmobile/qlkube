/* eslint-disable */
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

exports.mapK8ApiPaths = mapK8ApiPaths;