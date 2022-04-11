// small utility that creates a formatted url from a
// cdnjs returned object and an optional filename

module.exports = function(obj, file){
  if (!obj) return false
  var base = '//cdnjs.cloudflare.com/ajax/libs/';
  var file = file ? file : obj.filename;
  return base + obj.name + '/' + obj.version + '/' + file;
}