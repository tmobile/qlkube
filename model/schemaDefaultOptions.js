module.exports = () => {
  const options = {};
  // Setting default options
  options.strict = typeof options.strict === 'boolean' ? options.strict : false;
  // Schema options
  options.operationIdFieldNames =
    typeof options.operationIdFieldNames === 'boolean'
      ? options.operationIdFieldNames
      : false;
  options.fillEmptyResponses =
    typeof options.fillEmptyResponses === 'boolean'
      ? options.fillEmptyResponses
      : false;
  options.addLimitArgument =
    typeof options.addLimitArgument === 'boolean'
      ? options.addLimitArgument
      : false;
  options.genericPayloadArgName =
    typeof options.genericPayloadArgName === 'boolean'
      ? options.genericPayloadArgName
      : false;
  options.simpleNames =
    typeof options.simpleNames === 'boolean' ? options.simpleNames : false;
  options.singularNames =
    typeof options.singularNames === 'boolean' ? options.singularNames : false;
  options.createSubscriptionsFromCallbacks =
    typeof options.createSubscriptionsFromCallbacks === 'boolean'
      ? options.createSubscriptionsFromCallbacks
      : false;
  // Authentication options
  options.viewer = typeof options.viewer === 'boolean' ? options.viewer : true;
  options.sendOAuthTokenInQuery =
    typeof options.sendOAuthTokenInQuery === 'boolean'
      ? options.sendOAuthTokenInQuery
      : false;
  // Logging options
  options.provideErrorExtensions =
    typeof options.provideErrorExtensions === 'boolean'
      ? options.provideErrorExtensions
      : true;
  options.equivalentToMessages =
    typeof options.equivalentToMessages === 'boolean'
      ? options.equivalentToMessages
      : true;
  options.report = {
    warnings: [],
    numOps: 0,
    numOpsQuery: 0,
    numOpsMutation: 0,
    numOpsSubscription: 0,
    numQueriesCreated: 0,
    numMutationsCreated: 0,
    numSubscriptionsCreated: 0,
  };

  return options;
};
