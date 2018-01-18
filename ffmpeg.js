const ffmpeg = require('fluent-ffmpeg');

class FfmpegInstance {
    constructor (config) {
        this.config = config;
        this.cmd = new ffmpeg(config.stream)
            .native()
            .outputOptions(config.mappings)
            .complexFilter('ebur128=peak=true')
            .videoFilter("select='gt(scene,0)',showinfo")
            .format('null')
            .output('-');
        
        this.cmd.on('start', config.start);
        
        this.cmd.on('error', config.error);
        
        this.cmd.on('end', config.end);
        
        this.cmd.on('stderr', config.stderr);

        this.cmd.run();
    }
}

module.exports = FfmpegInstance