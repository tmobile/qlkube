const { logger } = require('../log');
const NodeRequest = require("request");
const debug_1 = require("debug");
const httpLog = debug_1.debug('http');
const graphql_1 = require("graphql");

function graphQLErrorWithExtensions(message, extensions) {
    return new graphql_1.GraphQLError(message, null, null, null, null, null, extensions);
}

function getK8SCustomResolver(k8sApiUrlPath, httpMethod) {
    // Return resolve function :
    return (source, args, context, info) => {
        let apiUrl = context.clusterURL + k8sApiUrlPath;
        apiUrl = apiUrl.replace('{namespace}', args['namespace']);
        apiUrl = apiUrl.replace('{name}', args['name']);
        logger.debug("getK8SCustomResolver : processing url " + apiUrl);
        const apiHeaders = {
            Authorization: context.authorization
        };
        options = {
            method: httpMethod,
            url: apiUrl,
            headers: apiHeaders,
        };
        httpLog(`Call ${options.method.toUpperCase()} ${options.url}\n` +
            `headers: ${JSON.stringify(options.headers)}\n` +
            `request body: ${options.body}`);
        return new Promise((resolve, reject) => {
            NodeRequest(options, (err, response, body) => {
                if (err) {
                    httpLog(err);
                    reject(err);
                    return;
                }
                httpLog(`${response.statusCode} - ${body}`);
                // handling errors
                if (response.statusCode < 200 || response.statusCode > 299) {
                    const errorString = `Could not invoke operation ${response.statusCode}`;
                    let responseBody;
                    try {
                        responseBody = JSON.parse(body);
                    }
                    catch (e) {
                        responseBody = body;
                    }
                    const extensions = {
                        method: options.method,
                        path: options.path,
                        statusCode: response.statusCode,
                        responseHeaders: response.headers,
                        responseBody
                    };
                    reject(graphQLErrorWithExtensions(errorString, extensions));
                    return;
                }
                if (!response.headers['content-type'] ||
                    !response.headers['content-type'].includes('application/json')) {
                    // TODO: Handle YAML
                    resolve(body);
                }
                /**
                 * If the response body is type JSON, then parse it
                 *
                 * content-type may not be necessarily 'application/json' it can be
                 * 'application/json; charset=utf-8' for example
                 */
                let responseBody;
                try {
                    responseBody = JSON.parse(body);
                } catch (e) {
                    const errorString = `Cannot JSON parse response body of ` +
                        `operation ${operation.operationString} ` +
                        `even though it has content-type 'application/json'`;
                    httpLog(errorString);
                    reject(errorString);
                }
                resolve(responseBody);
            });
        });
    };
}
module.exports = {
    getK8SCustomResolver: getK8SCustomResolver
};
