const Crypto = require('crypto');
var events = require('events');
const { createClient } = require('graphql-ws');
const ws = require('ws'); // yarn add ws


const connectSub = (
    internalServerUrl, 
    emitterId, 
    clientId, 
    query, 
    connectionParams,
    pairSubToClient,
    serverUsageCallback
) => {

    try {
      const em = new events.EventEmitter();
      const client = createClient({
        url: internalServerUrl,
        webSocketImpl: ws,
        /**
         * Generates a v4 UUID to be used as the ID.
         * Reference: https://gist.github.com/jed/982883
         */
        generateID: () =>
          ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
            (c ^ (Crypto.randomBytes(1)[0] & (15 >> (c / 4)))).toString(16),
          ),
          connectionParams
      });
  
      (async () => {
            const onNext = (val) => {
                serverUsageCallback(connectionParams?.clusterUrl)
                em.emit(emitterId, val);
              };
              await client.subscribe(
                {
                  query: query,
                  variables: connectionParams?.queryVariables

                },
                {
                  next: onNext,
                  error: (er) => onNext({data: {error: { errorPayload: er}}}),
                  complete: () => console.log('Subscription complete!', connectionParams.clientSubId),
                  onclose: () => console.log('onclose '),
                  
                },
              );
              const internalSubId = Date.now().toString(36) + Math.random().toString(36).substr(2);
              pairSubToClient(clientId, client, internalSubId, connectionParams.clientSubId)


      })().catch(e => console.log('Subscription error ::', e));
  
      return em;
    } catch (error) {
      console.log('Subscription connection failed ::', error)
    }
}

const connectQuery = async(
  internalServerUrl, 
  query, 
  connectionParams,
  serverUsageCallback
) => {

    const client = createClient({
      url: internalServerUrl,
      webSocketImpl: ws,
      /**
       * Generates a v4 UUID to be used as the ID.
       * Reference: https://gist.github.com/jed/982883
       */
      generateID: () =>
        ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
          (c ^ (Crypto.randomBytes(1)[0] & (15 >> (c / 4)))).toString(16),
        ),
        connectionParams
    });
    let queryResp = await (async () => {
      return result = await new Promise((resolve, reject) => {
        let result
        client.subscribe(
          {
            query: query,
            variables: connectionParams?.queryVariables

          },
          {
            next: (data) => {
              result = data;
            },
            error: (err) => console.log('Query error :: ', err),
            complete: () => resolve(result)
          }
        )
      })
    })().catch(e => console.log('Query error :: ', e))
    serverUsageCallback(connectionParams?.clusterUrl);
    return queryResp;
  }


  exports.connectSub = connectSub;
  exports.connectQuery = connectQuery;
