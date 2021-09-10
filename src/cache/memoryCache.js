var memoryCache = module.exports = function () {
    var cache = {
        clientId_subId_map:{},
        subId_watchObj_map:{},
        pathClientKey_subId_map:{}
    };
    return {
        get: function (key) { return cache[key]; },
        set: function (key, val) { cache[key] = val; }
    }
}