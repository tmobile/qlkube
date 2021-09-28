var fs = require('fs');

const updateReleaseVersion = (fileName, buildVersion) => {
  fs.readFile(fileName, 'utf8', function (err, data) {
    if (err) {
      return console.log(err);
    }
    var result = data.replace(/RELEASE_VERSION/g, buildVersion);

    fs.writeFile(fileName, result, 'utf8', function (err) {
      if (err) return console.log(err);
    });
  });
};

try {
  var buildVersion = process.argv[2];
  updateReleaseVersion('public/health.json', buildVersion);
  console.log('Build version set: ' + buildVersion);
} catch (error) {
  console.error('Error occurred:', error);
}
