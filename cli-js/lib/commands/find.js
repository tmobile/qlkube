// find 

var cache = require('../cache'),
    _ = require('lodash');

module.exports = function(query, cb){
  cache.read(function(pkg){
    var result = _.where(pkg, { name: query })
    if (result[0]){ cb(result[0]) } else { cb(false) }
  });
}