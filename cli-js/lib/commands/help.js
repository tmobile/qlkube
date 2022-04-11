// prints a bit of help

var print = require('../print_utils');

module.exports = function(){
  print.header('cli-js usage');
  console.log('list: '.bold + 'lists all packages');
  console.log('search [name]: '.bold + 'search packages for a keyword');
  console.log('info [name]: '.bold + 'more information on a specific package');
  console.log('copy [name]: '.bold + 'copies the cdnjs link to your clipboard');
  console.log('update: '.bold + 'updates the cache');
  console.log('install [name] [path]: '.bold + 'downloads the specified package to an optional path');
  console.log('');
}