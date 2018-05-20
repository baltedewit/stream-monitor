// require file system and jsdom
var fs = require('fs');

// For jsdom version 10 or higher.
// Require JSDOM Class.
var JSDOM = require('jsdom').JSDOM;
// Create instance of JSDOM.
var jsdom = new JSDOM('<body><div id="container"></div></body>', {runScripts: 'dangerously'});
// Get window
var window = jsdom.window;

// read and parse csv
var parse = require('csv-parse')

var parser = parse({delimiter: ',', columns: true, auto_parse: true}, async function(err, data){
	let short = []
	let integrated = []
	for (const row of data) {
		short.push([row.datetime.split(' ')[1], row.short])
		integrated.push([row.datetime.split(' ')[1], row.integrated])
	}
	await generateChart(short, 'short')
	generateChart(integrated, 'integrated')
});

// figure out the date:
var date = process.argv[2] || new Date().toLocaleDateString()
console.log('Parse CSV: '+date)

fs.createReadStream(`../stream-monitor/logs/${date}.csv`).pipe(parser);

function generateChart(data, name) {
	return new Promise((resolve) => {
		console.log('Generate Chart: '+name)
		// require anychart and anychart export modules
		var anychart = require('anychart')(window);
		var anychartExport = require('anychart-nodejs')(anychart);

		// create and a chart to the jsdom window.
		// chart creating should be called only right after anychart-nodejs module requiring
		var chart = anychart.line(data)
		chart.bounds(0, 0, 1600, 600);
		chart.container('container');
		chart.title(`${name} ${date}`)
		chart.draw();

		// generate JPG image and save it to a file
		anychartExport.exportTo(chart, 'svg').then(function(image) {
		fs.writeFile(`./generated/${date}_${name}.svg`, image, function(fsWriteError) {
			if (fsWriteError) {
				console.log(fsWriteError);
			} else {
				console.log('Complete');
			}
			resolve()
		});
		}, function(generationError) {
			console.log(generationError);
			resolve()
		});
	})
}
