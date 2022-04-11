var fs = require('fs'),
    request = require('request'),
    config = require('./config');

function read_packages(cb){
  check_cache_expire(function(){
    cb(JSON.parse(fs.readFileSync(config.cache_path, 'utf8')).packages);
  });
}

function check_cache_expire(cb){
  if (!fs.existsSync(config.cache_path)) { return cache_packages(cb) }
  var last_cached = fs.statSync(config.cache_path).mtime;
  var now = new Date;
  if (now.setDate(now.getDate() - config.days_to_cache_expire) > last_cached) {
    cache_packages(cb);
  } else {
    cb();
  }
}

function cache_packages(cb){
  request.get(config.url, function(err, res, body){
    fs.writeFileSync(config.cache_path, body);
    cb();
  });
}

module.exports = {
  read: read_packages,
  refresh: cache_packages
}