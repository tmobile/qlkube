var memoryCache = module.exports = function () {
    var cache = {
        serverMap: {}
    };
    return {
        get: function (key) { return cache[key]; },
        set: function (key, val) { cache[key] = val; }
    }
}