import fs from 'fs';

const bustCache = (file) => {
	fs.readFile(file, 'utf8', function (err, data) {
		if (err) { return console.log(err); }
		if (!data.includes('$cacheVersion')) { return; }
		var result = data.replace(/(\$cacheVersion\ \=\ \')(.*)(\'\;)/g, "$1" + new Date().getTime() + "$3");
		fs.writeFile(file, result, 'utf8', function (err) {
			if (err) return console.log(err);
		});
	});
};

export default bustCache;
