/* eslint-disable */
const k8s = require('@kubernetes/client-node');
const logger = require('pino')({ useLevelLabels: true });
const kc = new k8s.KubeConfig();

let watchMap = {};

function setupWatch(
  subscription,
  pubsub,
  authToken,
  clusterURL,
  namespace,
  clientIpAddress,
  pathUrl
) {
  _setupWatch(
    subscription.k8sType,
    pathUrl,
    pubsub,
    authToken,
    clusterURL,
    namespace,
    clientIpAddress
  );
}

function _setupWatch(
  kind,
  url,
  pubsub,
  authToken,
  clusterURL,
  namespace,
  clientIpAddress
) {
  (async (
    kind,
    url,
    pubsub,
    authToken,
    clusterURL,
    namespace,
    clientIpAddress
  ) => {
    const authTokenSplit = authToken.split(' ');
    const token = authTokenSplit[authTokenSplit.length - 1];

    kc.loadFromOptions({
      clusters: [{ server: clusterURL }],
      users: [{ token: token }],
      contexts: [{ name: namespace, token }],
      currentContext: namespace,
    });
    const watch = new k8s.Watch(kc);

    const publishEvent = (type, obj) => {
      logger.info(
        `watcher event:  ${type}, namespace: ${obj.metadata.namespace} name: ${obj.metadata.name}`
      );
      pubsub.publish(type, { event: type, object: obj });
    };

    const watchCallback = (type, obj, data) => {
      if (['ADDED', 'MODIFIED', 'DELETED'].includes(type)) {
        publishEvent(`${kind}_${type}`, obj);
      }
    };

    let timerId;

    const watchDone = () => {
      logger.info('watch done!');
      if (timerId != null) {
        clearTimeout(timerId);
      }
      timerId = setTimeout(setupWatch, 5000);
    };

    const watchError = (err) => {
      logger.error('watch err!', err.message);
    };

    const queryParams = {
      allowWatchBookmarks: true,
      forever: false,
      timeout: 10000,
    };

    const watchHandler = (req) => {
      currentWatchReq = req;
    };

    var currentWatchReq = null;

    setupWatch = async () => {
      return await watch
        .watch(url, queryParams, watchCallback, watchDone, watchError)
        .then((req) => {
          logger.info('watch request: ', JSON.stringify(req));
          return req;
        })
        .catch((err) => {
          logger.error('watch error: ', err.message);
        });
    };

    const returnedWatch = await setupWatch();
    setIpAddressWatchMap(clientIpAddress, returnedWatch)
  })(
    kind.toUpperCase(),
    url,
    pubsub,
    authToken,
    clusterURL,
    namespace,
    clientIpAddress
  );
}

function disconnectWatchable(clientIp) {
  if (watchMap[clientIp]) {
    let clientWatchList = watchMap[clientIp];
    clientWatchList.map((watchObj) => {
      watchObj.abort();
    });
    delete watchMap[clientIp];
  }
}

function setIpAddressWatchMap (clientIpAddress, cachedWatchable) {
  if (watchMap[clientIpAddress] && cachedWatchable) {
    let watchObjList = [...watchMap[clientIpAddress], cachedWatchable];
    watchMap[clientIpAddress] = watchObjList;
  } else {
    watchMap[clientIpAddress] = [cachedWatchable];
  }
}

function getWatchMap() {
  return watchMap;
}

exports.setupWatch = setupWatch;
exports.disconnectWatchable = disconnectWatchable;
exports.setIpAddressWatchMap = setIpAddressWatchMap;
exports.getWatchMap = getWatchMap;
