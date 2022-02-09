/* eslint-disable */
const { GraphQLString, GraphQLSchema, GraphQLObjectType } = require('graphql');
const { mergeSchemas } = require('graphql-tools');
const { createGraphQLSchema } = require('../openapi-to-graphql');
const { logger } = require('./log');
const { getK8SCustomResolver } = require('./resolver/customresolver');
const watch = require('./watch');

const customSubArgs = {
  'PodLogs': {
    namespace: { type: GraphQLString },
    name: { type: GraphQLString },
    container: { type: GraphQLString }
  }
}
const customBaseSchema = {
  'PodLogs': new GraphQLObjectType({
    name: 'apiV1NamespacePodLogEvent',
    fields: {
      log: { type: GraphQLString },
      container: { type: GraphQLString },
      pod: { type: GraphQLString }
    }
  })
}
const hasOuterWatch = (path) => {
  // check outer parameters of path
  if (path.parameters) {
    for (const param of path.parameters) {
      if (param.name === 'watch') {
        return true;
      }
    }
  }
  return false;
};

const hasGetWatch = (path) => {
  // check parameters of get operation
  if (path.get && path.get.parameters) {
    for (const param of path.get.parameters) {
      if (param.name === 'watch') {
        return true;
      }
    }
  }
  return false;
};

const hasWatch = (path) => hasOuterWatch(path) || hasGetWatch(path);

const injectUrl = (path, namespace) => {
  let urlInject = '';
  for (const pathSegment of path) {
    if (pathSegment !== '' && pathSegment !== '{name}') {
      pathSegment !== '{namespace}'
        ? (urlInject += `/${pathSegment}`)
        : (urlInject += `/${namespace}`);
    }
  }
  return path.length > 0 ? urlInject : '';
};
exports.injectUrl = injectUrl;

exports.hasWatchExp = (path) => hasOuterWatch(path) || hasGetWatch(path);

const WATCH_PARAM_NAMES = ['allowWatchBookmarks', 'watch', 'timeoutSeconds'];
const removeWatchParams = (path) => {
  const newPath = JSON.parse(JSON.stringify(path));
  newPath.parameters = newPath.parameters.filter(
    (param) => !WATCH_PARAM_NAMES.includes(param.name)
  );
  return newPath;
};

/**
 * Returns array of paths that are watchable
 * @param {Object} oas OpenAPI Spec from cluster
 */
exports.getWatchables = (oas) => {
  const watchPaths = [];
  const mappedWatchPath = {};
  const mappedNamespacedPaths = {};
  for (const pathName in oas.paths) {
    const path = oas.paths[pathName];

    if (
      hasWatch(path) ||
      pathName === '/api/v1/namespaces/{namespace}/pods/{name}/log'
    ) {
      const currentPathKeys = Object.keys(path);
      const pathKind =
        path[currentPathKeys[0]]['x-kubernetes-group-version-kind'].kind;
      const hasNamespaceUrl = pathName.includes('{namespace}');
      if (!hasNamespaceUrl) {
        if (mappedWatchPath[pathKind]) {
          const tempPaths = [...mappedWatchPath[pathKind], pathName];
          mappedWatchPath[pathKind.toUpperCase()] = tempPaths;
        } else {
          mappedWatchPath[pathKind.toUpperCase()] = [pathName];
        }
      } else if (mappedNamespacedPaths[pathKind]) {
        const tempPaths = [...mappedNamespacedPaths[pathKind], pathName];
        mappedNamespacedPaths[pathKind.toUpperCase()] = tempPaths;
      } else {
        mappedNamespacedPaths[pathKind.toUpperCase()] = [pathName];
      }
      watchPaths.push(path);
    }
  }

  return { watchPaths, mappedWatchPath, mappedNamespacedPaths };
};

/**
 * Removes the parameters having to do with watching on all watchable paths (since watching with graphQL doesn't make any sense)
 * This simplifies the args for query types in graphQL
 * @param {Object} oas OpenAPI Spec from cluster
 */
exports.deleteWatchParameters = (oas) => {
  const newOAS = JSON.parse(JSON.stringify(oas)); // Javascript is wierd, this is deep copy.
  for (const pathName in newOAS.paths) {
    const path = newOAS.paths[pathName];
    if (hasOuterWatch(path)) {
      newOAS.paths[pathName] = removeWatchParams(path);
    }
    if (hasGetWatch(path)) {
      newOAS.paths[pathName].get = removeWatchParams(path.get);
    }
  }
  return newOAS;
};

/**
 * Removes all endpoints with /watch/ in the pathname since those are now deprecated.
 * @param {object} oas The Open API Spec from k8s cluster
 */
exports.deleteDeprecatedWatchPaths = (oas) => {
  const newOAS = JSON.parse(JSON.stringify(oas)); // Javascript is wierd, this is deep copy.
  for (const pathName in newOAS.paths) {
    // don't include /watch/ paths since they are deprecated.
    if (pathName.includes('/watch/')) {
      delete newOAS.paths[pathName];
    }
  }
  return newOAS;
};

async function oasToGraphQlSchema(oas, kubeApiUrl) {
  const { schema } = await createGraphQLSchema(oas, {
    baseUrl: kubeApiUrl,
    viewer: false,
    customResolvers: {
      Kubernetes: {
        "/api/v1/namespaces/{namespace}/secrets/{name}": {
          get: getK8SCustomResolver('/api/v1/namespaces/{namespace}/secrets/{name}', 'get')
        },
        "/api/v1/namespaces/{namespace}/configmaps/{name}": {
          get: getK8SCustomResolver('/api/v1/namespaces/{namespace}/configmaps/{name}', 'get')
        }
      }
    },
    requestOptions: (method, path, title, resolverParams) => {
      if (
        resolverParams &&
        resolverParams.context &&
        resolverParams.context.clusterURL
      ) {
        return {
          url: `${resolverParams.context.clusterURL}${path}`,
        };
      }
      return null;
    },
    headers: (method, path, title, resolverParams) => ({
      Authorization: `${resolverParams.context.authorization}`,
      'Content-Type': method === 'patch' ? 'application/merge-patch+json' : 'application/json',
      'Accept': 'application/json, */*'
    }),
  });
  return schema;
}

function createSubscriptionSchema(
  baseSchema,
  schemaType,
  k8sType,
  k8sUrl,
  watchableNonNamespacePaths,
  mappedNamespacedPaths
) {
  const k8Data = { k8sUrl, k8sType, schemaType };
  const ObjectEventName = `${k8sType}Event`;

  const queryType = new GraphQLObjectType({
    name: 'Query',
    fields: {
      _dummy: { type: GraphQLString },
    },
  });

  let ObjectEventType;

  const _baseSchema = customBaseSchema[k8sType] ?
    customBaseSchema[k8sType] :
    baseSchema.getType(schemaType);

  ObjectEventType = new GraphQLObjectType({
    name: ObjectEventName,
    fields: {
      event: { type: GraphQLString },
      object: { type: _baseSchema },
    },
  });

  const kind = k8sType.toUpperCase();
  const events = [`${kind}_MODIFIED`, `${kind}_ADDED`, `${kind}_DELETED`, `${kind}_LOGGER`];

  const withCancel = (asyncIterator, onCancel) => {
    const asyncReturn = asyncIterator.return;

    asyncIterator.return = () => {
      onCancel();
      return asyncReturn ? asyncReturn.call(asyncIterator) : Promise.resolve({ value: undefined, done: true });
    };

    return asyncIterator;
  };

  // function newSubscription(parent, args, context) {
  function newSubscription(parent, args, context) {
    console.log('newSub!', args)
      const { namespace = null, name = null, container = null } = args;
    const pathIncludesRawNamespace = k8Data.k8sUrl.includes('{namespace}');
    let pathUrl = k8Data.k8sUrl;

    if (
      k8Data.k8sType === 'PodLogs' &&
      namespace &&
      name &&
      container
    ) {
      pathUrl = `/api/v1/namespaces/${namespace}/pods/${name}/log?tailLines=10&follow=true&container=${container}`;
      args['secondaryUrl'] = `/api/v1/namespaces/${namespace}/pods/${name}/log?tailLines=0&follow=true&container=${container}`
    } else if (namespace && pathIncludesRawNamespace) {
      logger.debug('Namespace Provided!', namespace);
      const focusedPath = k8Data.k8sUrl.split('/') || [];
      const injectedUrl = injectUrl(focusedPath, namespace);
      pathUrl = injectedUrl;
    } else if (!namespace && pathIncludesRawNamespace) {
      logger.debug('No namespace provided!');
      pathUrl =
        watchableNonNamespacePaths[kind.toUpperCase()] &&
          watchableNonNamespacePaths[kind.toUpperCase()][0]
          ? watchableNonNamespacePaths[kind.toUpperCase()][0]
          : '';
    } else if (
      namespace &&
      !pathIncludesRawNamespace &&
      mappedNamespacedPaths[kind.toUpperCase()][0]
    ) {
      logger.debug('Namespace not provided and not not requested!');
      const focusedPath =
        mappedNamespacedPaths[kind.toUpperCase()][0].split('/');
      const injectedUrl = injectUrl(focusedPath, namespace);
      pathUrl = injectedUrl;
    }

    // console.log('pathUrl', pathUrl)
    // console.log('context :DDDDD', context)

    // console.log(context.clientId, context.subId,args)
    const clientId = context.clientId;
    const subId = context.subId;
    const subArgs = args;
    const emitterId = context.emitterId;
    const pubsub = context.pubsub;
    // console.log('out2!! CHECKKKKK',
    // // k8Data,
    //   // context.pubsub,
    //   // null,
    //   context,
    //   // context.clusterURL,
    //   // namespace,
    //   // pathUrl,
    //   // subId,
    //   // clientId,
    //   // subArgs
    // )
    console.log('context.clusterUrl', context.clusterUrl)

    watch.setupWatch(
      k8Data,
      context.pubsub,
      // emitterId,
      context.authorization,
      context.clusterUrl,
      namespace,
      pathUrl,
      subId,
      clientId,
      subArgs
    );
    return withCancel(context.pubsub.asyncIterator(events), () => {
      logger.debug('Disconnect client id', clientId)
      watch.disconnectSpecificSocket(clientId, subId)
    });
  }

  const fields = {};

  fields[ObjectEventName] = {
    type: ObjectEventType,
    args: customSubArgs[k8sType] ?
      {
        ...customSubArgs[k8sType]
      } :
      {
        namespace: { type: GraphQLString },
      },
    resolve: (payload) => payload,
    subscribe: newSubscription,
  };



  const subscriptionType = new GraphQLObjectType({
    name: 'Subscription',
    fields,
  });

  const schema = new GraphQLSchema({
    query: queryType,
    subscription: subscriptionType,
  });

  return schema;
}

exports.createSchema = async (
  oas,
  kubeApiUrl,
  subscriptions,
  watchableNonNamespacePaths,
  mappedNamespacedPaths
) => {
  const baseSchema = await oasToGraphQlSchema(oas, kubeApiUrl);
  const schemas = [baseSchema];
  const pathMap = {};

  subscriptions.forEach((element) => {
    let ObjectEventName;
    if (element.k8sUrl === '/api/v1/namespaces/{namespace}/pods/{name}/log') {
      element.k8sType = `${element.k8sType}Logs`
      ObjectEventName = `${element.k8sType}Event`;
    } else {
      ObjectEventName = `${element.k8sType}Event`;
    }
    const includesNamespace = element.k8sUrl.includes('{namespace}');
    const includesName = element.k8sUrl.includes('{name}');

    if (includesName && includesNamespace && !pathMap[ObjectEventName]) {
      pathMap[ObjectEventName] = true;
      const schema = createSubscriptionSchema(
        baseSchema,
        element.schemaType,
        element.k8sType,
        element.k8sUrl,
        watchableNonNamespacePaths,
        mappedNamespacedPaths
      );
      schemas.push(schema);
    }
  });
  return mergeSchemas({ schemas });
};
