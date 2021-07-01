let chai = require('chai'); 
const getOpenApiSpec = require('../src/oas');

require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

describe('functions within oas.js', () => {
    it('should not return k8 api spec without providing token or url', async() => {
        let openApiSpecResponse = await getOpenApiSpec('', {});
        chai.assert.exists(openApiSpecResponse['error'])

    });
})