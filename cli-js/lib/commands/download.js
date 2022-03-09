// download given package to optional given path, or cwd

var fs = require('fs'),
    cache = require('../cache'),
    find = require('./find'),
    async = require('async'),
    http = require('http'),
    path = require('path'),
    config = require('../config'),
    format_url = require('../format_url');


module.exports = function(query, base_path, cb){
  if (typeof base_path == 'function'){
    cb = base_path;
    base_path = config.download_path;
  } else {
    fs.existsSync(base_path) || fs.mkdirSync(base_path);
  }

  cache.read(function(pkg){
    find(query, function(result){
      if (!result) return cb('package not found')
      var dir = path.join(base_path, result.name);
      fs.existsSync(dir) || fs.mkdirSync(dir);
      async.map(result.assets[0].files, download_file, function(err){
        cb(err, result);
      });

      function download_file(f, callback){
        var file = fs.createWriteStream(path.join(dir, f));
        http.get(format_url(result, f), function(data){
          data.pipe(file);
          data.on('end', function(){ callback(null); });
          data.on('error', function(){ callback(error); });
        });
      }

    });
  });

}