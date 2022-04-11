var fuzzy = require('fuzzy'),
    cache = require('../cache');

//
// search
//

module.exports = function(query, cb){
  cache.read(function(pkg){
    var names = pkg.map(function(a){ return a.name });
    cb(fuzzy.filter(query, names).map(function(a){ return a.string }));
  });
}