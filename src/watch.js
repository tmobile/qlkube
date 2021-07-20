/* eslint-disable */
const k8s = require('@kubernetes/client-node');
const kc = new k8s.KubeConfig();
const logger = require('pino')({ useLevelLabels: true });
const cache = require('./cache/memoryCache')();

const cid_sid_map='cid_sid_map';
const sid_wtc_map='sid_wtc_map';
const ptclKey_sid_map='ptclKey_sid_map';
let pathKindMap = {}

function setupWatch(
  subscription,
  pubsub,
  authToken,
  clusterURL,
  namespace,
  pathUrl,
  subId,
  clientId
) {

  _setupWatch(
    subscription.k8sType,
    pathUrl,
    pubsub,
    authToken,
    clusterURL,
    namespace,
    subId,
    clientId,
  )
}

const _setupWatch = async(
  kind,
  url,
  pubsub,
  authToken,
  clusterURL,
  namespace,
  subId,
  clientId,
)=> {

  const authTokenSplit = authToken.split(' ');
  const token = authTokenSplit[authTokenSplit.length - 1];

  kc.loadFromOptions({
    clusters: [{ server: clusterURL }],
    users: [{ token: token }],
    contexts: [{ name: namespace, token }],
    currentContext: namespace,
  });
  const watch = new k8s.Watch(kc);

  const watchCallback = (type, obj, data) => {
    if (['ADDED', 'MODIFIED', 'DELETED'].includes(type)) {
      publishEvent(`${upperKind}_${type}`, obj);
    }
  };

  const publishEvent = (type, obj) => {
    logger.info(
      `watcher event:  ${type}, namespace: ${obj.metadata.namespace} name: ${obj.metadata.name}`
    );
    pubsub.publish(type, { event: type, object: obj });
  };


  let timerId;

  const watchDone = (err) => {
    logger.info('watch done', err, subId);
    if (timerId != null) { clearTimeout(timerId); }
    timerId = setTimeout(async() => {
      if(
        cache.get(cid_sid_map)[clientId]&&
        cache.get(cid_sid_map)[clientId].includes(subId)
      ){
        setupWatch(url, subId);
      }
    }, 5000);
  };

  const watchError = (err) => {
      logger.error('watch err!', err.message);
  };

  const queryParams = {
    allowWatchBookmarks: true,
    forever: false,
    timeout: 10000,
  };

  setupWatch = async (instancedUrl, instancedSubId) => {
    const instancedUrlClone = instancedUrl ? instancedUrl : null;
    const urlClone= url;
    const urlTarget=  instancedUrlClone ? instancedUrlClone : urlClone;
    const urlKind= pathKindMap[urlTarget];
    const currentSubId = getPathClientKey(urlTarget, clientId);

    subId = instancedSubId ? instancedSubId : cache.get(ptclKey_sid_map)[currentSubId];
    url = urlTarget;
    upperKind= urlKind.toUpperCase();
    
    return await watch
      .watch(
        urlTarget, 
        queryParams,
        watchCallback, 
        watchDone, 
        watchError
      )
      .then((req) => {
        logger.info('watch request: ', urlTarget);
        return req;
      })
      .catch((err) => {
        logger.error('watch error: ', err.message);
      });
  };

  let upperKind = kind.toUpperCase();
  if(!pathKindMap[url]){ pathKindMap[url]=kind }
  mapSubIdToClientId(clientId, subId);
  const returnedWatch = await setupWatch(null, subId)
  mapWatchToSubId(subId, returnedWatch);
  mapPathClientKeyToSubId(url, clientId, subId);

}

/**
 * Maps subscription id's to their respective client id's
 * This enables us to keep track of all subscriptions on a websocket
 * @param {Object} clientId generated on client to demarcate a specific client
 * @param {Object} subId generated on qlkube server to demarcate a specific client
 */
function mapSubIdToClientId(clientId, subId){
  let cid_sid_map_cacheClone= deepClone(cache.get(cid_sid_map));
  if(cid_sid_map_cacheClone[clientId]){
    let newSubClientMap = [...cid_sid_map_cacheClone[clientId], subId];
    cid_sid_map_cacheClone[clientId] = newSubClientMap;
  }else{
    cid_sid_map_cacheClone[clientId]= [subId];
  }
  cache.set(cid_sid_map, cid_sid_map_cacheClone);
}

/**
 * Maps watch objects to subscription ids
 * This enables us quickly back reference specific subscriptions for abort() calls
 * @param {Object} watchObj generated within setupWatch, contains our watch subscription
 * @param {Object} subId generated on qlkube server to demarcate a specific client
 */
function mapWatchToSubId(subId, watchObj){
  let sid_wtc_map_cache= cache.get(sid_wtc_map);
  sid_wtc_map_cache[subId]= watchObj;
  cache.set(sid_wtc_map, sid_wtc_map_cache);
}

/**
 * Maps client id and path to sub ids -> <path><clientId> : subid, should automatically end duplicated path subs
 * This lets us back reference subscription ids during event callbacks
 * @param {Object} path from k8 api spec
 * @param {Object} clientId generated on qlkube server to demarcate a specific client
 * @param {Object} subId generated on qlkube server to demarcate a specific client
 */
async function mapPathClientKeyToSubId(path, clientId, subId){
  let ptclKey_sid_map_cacheClone= deepClone(cache.get(ptclKey_sid_map));
  const pathClientKey = getPathClientKey(path, clientId);
  if(ptclKey_sid_map_cacheClone[pathClientKey]){
    // await endSpecifiedWatch(clientId, path); //look into
  }
  ptclKey_sid_map_cacheClone[pathClientKey]= subId;
  cache.set(ptclKey_sid_map, ptclKey_sid_map_cacheClone);
}

/**
 * Lets us end a specific watch
 * @param {Object} path from k8 api spec
 * @param {Object} clientId generated on qlkube server to demarcate a specific client
 */
function endSpecifiedWatch(clientId, path){
  let ptclKey_sid_map_cacheClone= deepClone(cache.get(ptclKey_sid_map));
  let sid_wtc_map_cacheClone= deepClone(cache.get(sid_wtc_map));
  let cid_sid_map_cacheClone= deepClone(cache.get(cid_sid_map));
  const pathClientKey = getPathClientKey(path, clientId);
  if(ptclKey_sid_map_cacheClone[pathClientKey]){
    const watchSubId= ptclKey_sid_map_cacheClone[pathClientKey];
    const watchObj = cache.get(sid_wtc_map)[watchSubId]; 
    const clientSubMapIndex = cid_sid_map_cacheClone[clientId].indexOf(watchSubId);
    if(watchObj){
      watchObj.abort();
      delete sid_wtc_map_cacheClone[watchSubId];
      delete ptclKey_sid_map_cacheClone[pathClientKey];
      if(clientSubMapIndex!==-1){
        let updatedClientSubMap = cid_sid_map_cacheClone[clientId].filter(subId => {
          return subId !== watchSubId
        })
        cid_sid_map_cacheClone[clientId]= updatedClientSubMap;
      }
      cache.set(cid_sid_map, cid_sid_map_cacheClone);
      cache.set(sid_wtc_map, sid_wtc_map_cacheClone);
      cache.set(ptclKey_sid_map, ptclKey_sid_map_cacheClone);
    }
  }
}

/**
 * Simple return for ptclKey_sid_map, key
 * @param {Object} clientId generated on qlkube server to demarcate a specific client
 * @param {Object} path from k8 api spec
 */
function getPathClientKey(path, clientId){
  return `${path}${clientId}`
}

/**
 * Discontinue all watchables for specified client
 * @param {Object} clientId generated on qlkube server to demarcate a specific client
 */
function disconnectWatchable(clientId) {
  let ptclKey_sid_map_cacheClone= deepClone(cache.get(ptclKey_sid_map));
  let sid_wtc_map_cacheClone= deepClone(cache.get(sid_wtc_map));
  let cid_sid_map_cacheClone= deepClone(cache.get(cid_sid_map));
  if(cid_sid_map_cacheClone[clientId]){
    let allSubs = cid_sid_map_cacheClone[clientId];
    const ptclKey_sid_map_CLONE = deepClone(ptclKey_sid_map_cacheClone);
    const sid_wtc_map_CLONE = deepClone(sid_wtc_map_cacheClone);

    for(const [clientPathKey, subId] of Object.entries(ptclKey_sid_map_CLONE)){
      if(allSubs.includes(subId)){
        delete ptclKey_sid_map_cacheClone[clientPathKey]
      }
    }
    for(const [subKey, wtchObj] of Object.entries(sid_wtc_map_CLONE)){
      if(allSubs.includes(subKey)){
        let subToAbort = cache.get(sid_wtc_map)[subKey];
        subToAbort.abort();
        delete sid_wtc_map_cacheClone[subKey];
      }
    }
    delete cid_sid_map_cacheClone[clientId]
    cache.set(cid_sid_map, cid_sid_map_cacheClone);
    cache.set(sid_wtc_map, sid_wtc_map_cacheClone);
    cache.set(ptclKey_sid_map, ptclKey_sid_map_cacheClone);
  }
}

function getWatchMap() {
  return '';
}

function deepClone(objet){
  return JSON.parse(JSON.stringify(objet))
}

function generateSubId(){
  const newId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  return newId
}

exports.setupWatch = setupWatch;
exports.disconnectWatchable = disconnectWatchable;
exports.getWatchMap = getWatchMap;
exports.generateSubId = generateSubId;