const SwaggerClient = require('swagger-client');
const { printColor } = require('./utils/consoleColorLogger');
const fetch = require('node-fetch');
const openApiPaths = ['/openapi/v2'];
const {
  getWatchables,
  deleteDeprecatedWatchPaths,
  deleteWatchParameters,
} = require('./schema');

const getOpenApiSpec = async(url, token) => {
  try {
    const openApiUrl = url + openApiPaths[0];
    const requestOptions = {
      timeout: 600000
    };
    if (token && token.length > 0) {
      requestOptions.headers = {
        Authorization: `Bearer ${token}`,
      }
    }
    const response = await fetch(openApiUrl, requestOptions);
  
    return response.json();
  } catch (error) {
    return {
      error: {
        errorPayload: error
      }
    }
  }

};

const normalizeData = (derefSpec_spec) => {
  if(derefSpec_spec){
      const oasWatchable = deleteDeprecatedWatchPaths(derefSpec_spec);
      const oas = deleteWatchParameters(oasWatchable);
      const subs = getWatchables(oasWatchable);
      return {
          oas,
          subs,
      }
  }
}
const dereferenceOpenApiSpec = async(rawSpec) => {
  try {
    printColor('yellow', 'De-referenceing api Specification...');
    const oasWatchable = deleteDeprecatedWatchPaths(rawSpec);
    const oas = deleteWatchParameters(oasWatchable);
    const resolvedSchema = await SwaggerClient.resolve({ spec: oas });
    return resolvedSchema;
  } catch (error) {
    return {
      error: { errorPayload: error }
    }
  }
}

const generateDereferencedOas = async(kubeApiUrl, schemaToken) => {
  try {
    // logger.debug('Generating cluster schema - Custom', kubeApiUrl)
    const authTokenSplit = schemaToken.split(' ');
    const token = authTokenSplit[authTokenSplit.length - 1];
    const oasRaw = await getOpenApiSpec(kubeApiUrl, token);

    if(!oasRaw?.definitions) throw new Error('unable to retrieve oas');
    
    const { subs, oas } = normalizeData(oasRaw);
    const derefSpec = await dereferenceOpenApiSpec(oas);

    if(derefSpec?.spec?.definitions){
      return {
        derefSpec,
        subs
      }
    }
    else throw new Error('unable to dereference oas')
  } catch (error) {
    printColor('red', error);
    return {
      error: { errorPayload: error }
    }
  }
}

exports.getOpenApiSpec = getOpenApiSpec;
exports.normalizeData = normalizeData;
exports.dereferenceOpenApiSpec = dereferenceOpenApiSpec;
exports.generateDereferencedOas = generateDereferencedOas;

