const fetch = require('node-fetch');

const openApiPaths = ['/openapi/v2'];

module.exports = async function getOpenApiSpec(url, token) {
  const openApiUrl = url + openApiPaths[0];
  const response = await fetch(openApiUrl, {
    timeout: 5000,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
};
