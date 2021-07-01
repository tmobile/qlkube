const fetch = require('node-fetch');

const openApiPaths = ['/openapi/v2'];

module.exports = async function getOpenApiSpec(url, token) {
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
