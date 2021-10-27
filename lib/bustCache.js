const fs = require('fs');
const pathConfig = require('path');
const parentPath = process.cwd();
const ourPackage = require(process.cwd() + '/package.json');

const bustCache = (file) => {
	fs.readFile(file, 'utf8', function (err, data) {
		if (err) {
			return console.log(err);
		}
		var result = data.replace(/(\$cacheVersion\ \=\ \')(.*)(\'\;)/g, "$1" + new Date().getTime() + "$3");
		fs.writeFile(file, result, 'utf8', function (err) {
			if (err) return console.log(err);
		});
	});
};

module.exports = bustCache;