let chai = require('chai'); 
const { dereferenceOpenApiSpec } = require('../src/oas');
const dummyApiSpec = require('./openpispec.json');

require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

describe('test functions within oas.js', () => {
    it('return dereferenced open api spec', async() => {
        let derefDummySpec = await dereferenceOpenApiSpec(dummyApiSpec);
        const lol = 0;
        chai.assert.exists(derefDummySpec['spec']['paths']);

    });
})