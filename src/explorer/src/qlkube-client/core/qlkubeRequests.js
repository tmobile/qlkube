import { ServerStatus } from '../enum/qlkube.enum';
// import https from 'http';


// import urlParse from 'url';

const clientId = `client-${Date.now().toString(36) + Math.random().toString(36).substr(2)}`;

function SubscriptionHandle(
  queryString,
  subscriptionId,
  unsubscribe
){
  this.queryString= queryString
  this.subscriptionId= subscriptionId
  this.unsubscribe= unsubscribe
}

const isJsonString = (str) => {
  try { return JSON.parse(str) } 
  catch (e) { return false; }
}

const processData = (finalData, serverStatusCallback, res) => {
  const response= finalData;
  if(!response&&res?.statusCode===200)
    return;

  const { data, status }= response;
  if(!data&&status === ServerStatus.generating){
    serverStatusCallback&&serverStatusCallback(ServerStatus.generating);
    return {
      suspendResolve: true,
      status: ServerStatus.generating
    }
  }else if (
    data&&(status===ServerStatus.exists||status===ServerStatus.complete)
  ){
    serverStatusCallback&&serverStatusCallback(ServerStatus.exists);
    return data
  }
}

export const subscribe = (queryString, clusterUrl, token, ws, isMono, connectionParams) => {
  const messageServer = (msg) => {
    ws?.send(msg)
  }
  const subscriptionId = `subscription-${Date.now().toString(36) + Math.random().toString(36).substring(1,10)}`;

  if(isMono){
    const monoClientId = `client-${Date.now().toString(36) + Math.random().toString(36).substr(2)}`;
    messageServer(JSON.stringify({
      requestType: 'subscribe_mono',
      clientId: monoClientId,
      connectionParams
    }));
    return new SubscriptionHandle(
      queryString,
      subscriptionId,
      () => messageServer(JSON.stringify({
        requestType: 'close',
        connectionParams: {
          clusterUrl: clusterUrl,
          clientId: monoClientId,
          clientSubId: `${subscriptionId}`
        }
      }))
    )
  }else{
    messageServer(JSON.stringify({
      requestType: 'subscribe',
      clientId,
      query: queryString,
      connectionParams: {
        authorization: `Bearer ${token}`,
        clusterUrl: clusterUrl,
        clientId: clientId,
        clientSubId: subscriptionId
      }
    }));
    return new SubscriptionHandle(
      queryString,
      subscriptionId,
      () => messageServer(JSON.stringify({
        requestType: 'close',
        connectionParams: {
          clusterUrl: clusterUrl,
          clientId: clientId,
          clientSubId: `${subscriptionId}`
        }
      }))
    )
  }

};

// export const request = async (
//   connectionParams,
//   qlkubeUrl,
//   serverStatusCallback
// ) => {
//   try {
//     const opts = urlParse.parse(qlkubeUrl)
//     opts.headers = {};
//     opts.headers['Content-Type'] = 'application/json';
//     opts.headers['connectionParams'] = connectionParams;
//     opts['timeout'] = 500000;
//     const httpRequestPromise= new Promise((resolve, reject) => {
//       https.request(opts, function (res) {
//         let chunks = []
//         res.setEncoding('utf8');
//         res.on('data', async function (body) {
//           const validJson= await isJsonString(body);
//           if(validJson){
//             const result= processData(validJson, serverStatusCallback, res);
//             if(!result.suspendResolve){
//               resolve(result)
//             }else{}
//           }else{
//             chunks.push(new Buffer.from(body))
//           }
//         });
//         res.on('error', (err) => {throw new Error(err)});
//         res.on('close', (msg) => {});
//         res.on('end', function () {
//           if(chunks?.length>0){
//             const data = Buffer.concat(chunks);
//             const parsedChunks = JSON.parse(data);
//             const result= processData(parsedChunks, serverStatusCallback, null);
//             resolve(result)
//           }
//         })
//       }).end(() => {});
//     })
//     return httpRequestPromise;
//   } catch (error) {}
// };
