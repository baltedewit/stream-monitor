const csvWriter = require('csv-write-stream')
const fs = require('fs')
const config = require('./config.json')

module.exports = function (object) {
	const date = new Date()
	let writer = csvWriter({ sendHeaders: false })
	if (!fs.existsSync(`./logs/${date.toLocaleDateString()}.csv`)) {
		writer = csvWriter()
	}
	writer.pipe(fs.createWriteStream(`./logs/${date.toLocaleDateString()}.csv`, { flags: 'a' }))
	writer.write({ datetime: date.toLocaleString(), ...object })
	writer.end()
}
