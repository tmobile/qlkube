var memoryCache = module.exports = function () {
    var cache = {
        cid_sid_map:{},
        sid_wtc_map:{},
        ptclKey_sid_map:{}
    };
    return {
        get: function (key) { return cache[key]; },
        set: function (key, val) { cache[key] = val; }
    }
}