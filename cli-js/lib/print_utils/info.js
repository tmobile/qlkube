// prints package information given an object from cdnjs

var header = require('./header'),
    colors = require('colors');

module.exports = function(obj){
  header(obj.name);

  console.log(obj.description);
  console.log('');
  console.log('Current Version: '.bold + obj.version);
  console.log('Docs: '.bold + obj.homepage);

  if (obj.maintainers){
    console.log('Maintainers: '.bold)
    obj.maintainers.forEach(function(m){
      console.log('  - ' + m.name);
    });
  }

  console.log('');

}