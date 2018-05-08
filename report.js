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

var parser = parse({delimiter: ',', columns: true, auto_parse: true}, function(err, data){
	let integrated = []
	for (const row of data) {
		integrated.push([ row.datetime, row.integrated ])
	}
	generateChart(integrated, 'integrated')

	let momentary = []
	for (const row of data) {
		momentary.push([ row.datetime, row.momentary ])
	}
	generateChart(momentary, 'momentary')
});

// figure out the date:
var date = process.argv[2] || new Date().toLocaleDateString()

fs.createReadStream(`../stream-monitor/logs/${date}.csv`).pipe(parser);

function generateChart(data, name) {
	// require anychart and anychart export modules
	var anychart = require('anychart')(window);
	var anychartExport = require('anychart-nodejs')(anychart);

	// create and a chart to the jsdom window.
	// chart creating should be called only right after anychart-nodejs module requiring
	var chart = anychart.line(data);
	chart.bounds(0, 0, 800, 600);
	chart.container('container');
	chart.title(name)
	chart.draw();

	// generate JPG image and save it to a file
	anychartExport.exportTo(chart, 'svg').then(function(image) {
	fs.writeFile(`./generated/${name}.svg`, image, function(fsWriteError) {
		if (fsWriteError) {
			console.log(fsWriteError);
		} else {
			console.log('Complete');
		}
	});
	}, function(generationError) {
		console.log(generationError);
	});
}
