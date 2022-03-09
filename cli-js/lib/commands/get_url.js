// get specified package's cdnjs url

var cache = require('../cache'),
    find = require('./find'),
    format_url = require('../format_url');

module.exports = function(query, cb){
  cache.read(function(pkg){
    find(query, function(result){ cb(format_url(result)); });
  });
}