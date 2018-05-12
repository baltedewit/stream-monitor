const config = require('./config.json');
const warnings = require('./warnings.js');
const FfmpegInstance = require('./ffmpeg.js');
const logger = require('./logger.js');
const { exec } = require('child_process')
const fs = require('fs')

const state = {
    lastAudioFrame: new Date(),
    silenceWarningSent: false,
    lastVideoFrame: new Date(),
    staticImageWarningSent: false,
    connected: 0,
    errored: false,
    errorTime: 0
}

const frameHistory = [];

const ffmpegConfig = {
    stream: config.stream,
    mappings: config.mappings,
    start: function (cmdLine) {
        // wait 1s for error handler
        setTimeout(() => {
            // prevent warning in case error happened too recently.
            if (new Date() - state.errorTime < 5000)
                return;

            console.log('Started ffmpeg with ' + cmdLine);
            warnings.slackMessage("Stream started with: \n"+cmdLine);

            if (state.errored)
                state.errored = false;
        }, 1000);
    },
    end: function () {
        console.log('Playback ended, this should never happen. Exiting.');
        warnings.slackMessage("Playback ended, this should never happen. Exiting.", function () {
            process.exit(-1);
        });
    },
    error: function (err) {
        if (state.errored) {
            state.errorTime = new Date();

            setTimeout(() => {
                ffmpeg = new FfmpegInstance(ffmpegConfig);
            }, 60*1000);
        } else {
            console.log('error, will retry every 60s: ', err);
            state.errored = true;
            state.errorTime = new Date();

            warnings.slackMessage("Stream errored, retrying every 60s...", function () {
                setTimeout(() => {
                    ffmpeg = new FfmpegInstance(ffmpegConfig);
                }, 60*1000);
            });
        }
    },
    stderr: function (line) {
        let segments = line.split(' ');
        if (segments[0].indexOf('[Parsed_ebur128') == 0) {
            parseEbuMessage(segments);
        } else if (segments[0].indexOf('[Parsed_showinfo_1') == 0) {
            parseSceneChangeMessage(segments);
        }
    }
}

let ffmpeg = new FfmpegInstance(ffmpegConfig);

/**
 * Parses messages with segments of ebu ffmpeg info and passes these to a handler.
 * @param {Array<String>} segments 
 */
function parseEbuMessage(segments) {
    let data = [];
    let object = {};

    if (state.connected == 0) {
        state.connected = new Date();
        console.log('Connected!');
    }

    for (let i in segments) {
        if (segments[i] !== '') {
            data.push(segments[i]);
        }
    }

    for (let i = 0; i < data.length; i++) {
        switch (data[i]) {
            case 't:' :
                object.time = Number(data[i + 1]);
                i++;
                break;
            case 'M:' :
                object.momentary = Number(data[i + 1]);
                i++;
                break;
            case 'S:' :
                object.short = Number(data[i + 1]);
                i++;
                break;
            case 'I:' :
                object.integrated = Number(data[i + 1]);
                i += 2;
                break;
            case 'LRA:' :
                object.LRA = Number(data[i + 1]);
                i += 2;
                break;
            case 'FTPK:' :
                object.frameTPK = [Number(data[i + 1]), Number(data[i + 2])];
                i += 3;
                break;
            case 'TPK:' :
                object.TPK = [Number(data[i + 1]), Number(data[i + 2])];
                i += 3;
                break;
            default :
                break;
        }
    }

    if (!object.time)
        return;

    handleEbuMessage(object);
}

/**
 * Parses messages with segments of ffmpeg scene change information and passes these
 * on to a handler.
 * Incoming segements have the following information:
 *      n:      number of the scene change
 *      pts:
 *      pos:
 *      fmt:    pixel format
 *      sar:    square pixel aspect ratio
 *      s:      size
 *      i:      interlaced?
 *      iskey:  is keyframe?
 *      type:   I, P, B
 *      checksum:
 *      plane_checksum
 *      mean:   
 *      stdev:  standard deviation
 * @param {Array<String>} segments 
 */
function parseSceneChangeMessage(segments) {
    const obj = {};

    for (let segment of segments) {
        if (segment.indexOf('stdev') == 0) {
            obj.stdev = Number(segment.substr(7));
        } else if (segment.indexOf('mean') == 0) {
            obj.mean = Number(segment.substr(6));
        }
    }

    if (obj.stdev && obj.mean)
        handleSceneChangeMessage(obj);
}

/**
 * Resets the state regarding sent silence warnings, and logs to slack.
 */
function resetSilenceWarning() {
    state.silenceWarningSent = false;

    warnings.slackMessage("Audio resumed on RTV Slogo at "+new Date().toLocaleTimeString());
    warnings.emailMessage(" Opheffing stilte alarm voor RTV Slogo", 
        "Dit is een automatisch bericht van de stream monitor app.\n Het kanaal RTV Slogo is om "+new Date().toLocaleTimeString()+" herstart met het uitzenden van geluid.");
}

function resetStaticImageWarning() {
    state.staticImageWarningSent = false;

    warnings.slackMessage("Video resumed on RTV Slogo at "+new Date().toLocaleTimeString());
    warnings.emailMessage("Statisch beeld alarm voor RTV Slogo",
        "Dit is een automatisch bericht van de stream monitor app.\n Het kanaal RTV Slogo is om "+new Date().toLocaleTimeString()+" herstart met het uitzenden van beeld.");
}

/**
 * handles js objects with ffmpeg scene change info.
 * specifically: maintains an array with stdev and mean info.
 * @param {Object} object 
 */
function handleSceneChangeMessage(object) {
    // state.staticImageWarningSent = false;
    // state.lastVideoFrame = new Date();

    frameHistory.push(object);
    if (frameHistory.length > 10) {
        frameHistory.splice(0, 1);
    }
}

/**
 * Handles javascript objects with ffmpeg ebu info.
 * Specifically, checks if the frame's true peak is higher than the level in the 
 * config, and if so, it sets the state.
 * @param {Object} object 
 */
function handleEbuMessage(object) {
    if (object.frameTPK[0] > config.dBFS) {
        if (state.silenceWarningSent) {
            resetSilenceWarning();
        }
        state.lastAudioFrame = new Date();
    }

    if (config.loudnessLogs === true) {
        const checks = ['time', 'momentary', 'short', 'integrated', 'LRA', 'frameTPK', 'TPK']
        for (const key of checks) {
            if (typeof object[key] === 'undefined') {
                return
            }
        }
        let csvObj = {...object}
        csvObj.frameTPK = object.frameTPK[0]
        csvObj.TPK = object.TPK[0]
        logger(csvObj)
    }
}

/**
 * Calculates the delta in motion measured by ffmpeg over the last
 * 10 measurements. Then decides whether motion was enough to consider
 * a non-static video frame.
 */
function calculateMotion() {
    if (frameHistory.length == 0)
        return;

    let stdev = [frameHistory[0].stdev, frameHistory[0].stdev];
    let mean = [frameHistory[0].mean, frameHistory[0].mean];

    for (let frame of frameHistory) {
        if (frame.stdev < stdev[0])
            stdev[0] = frame.stdev;
        if (frame.stdev > stdev[1])
            stdev[1] = frame.stdev;
        
        if (frame.mean < mean[0])
            mean[0] = frame.mean;
        if (frame.mean > mean[1])
            mean[1] = frame.mean;
    }
    
    if (stdev[1]-stdev[0] > 0.01 || mean[1]-mean[0] > 4)
        if (state.staticImageWarningSent)
            resetStaticImageWarning();
        state.lastVideoFrame = new Date();
}

async function generateLogs() {
    let date = new Date(Date.now() - 3600000).toLocaleDateString() // date from 1 hr ago
    warnings.slackMessage('Generating loudness report...')
    if (config.loudnessRsync) {
        await exec(`rsync -av ./logs ${config.loudnessRsync}`)
    }
    await exec('node ./report.js ' + date)
    if (config.loudnessRsync) {
        await exec(`rsync -av ./generated ${config.loudnessRsync}`)
    }
    warnings.sendReport(date, () => {
        fs.unlinkSync(`./logs/${date}.csv`)
        fs.unlinkSync(`./generated/${date}_integrated.png`)
        fs.unlinkSync(`./generated/${date}_momentary.png`)
        warnings.slackMessage('Generated loudness report.')
    })
}

// run checks every second
setInterval(function () {
    if (!state.connected || state.errored)
        return;

    calculateMotion();

    if (!state.silenceWarningSent && new Date() - state.lastAudioFrame > config.audioTimeout*1000) { // silence for 30 seconds
        state.silenceWarningSent = true;
 
        warnings.slackMessage("No audio on RTV Slogo Stream since "+state.lastAudioFrame.toLocaleTimeString());
        warnings.emailMessage("Stilte alarm voor RTV Slogo!",
            "Dit is een automatische waarschuwing van de stream monitor app.\n Het kanaal RTV Slogo is sinds "+state.lastAudioFrame.toLocaleTimeString()+" stil geweest. \n\nU ontvangt hiervan geen melding meer totdat het geluid wordt hervat.")

        console.log('Silence Warning!')
    }

    if (!state.staticImageWarningSent && new Date() - state.lastVideoFrame > config.videoTimeout*1000) { // static image for 30 seconds
        state.staticImageWarningSent = true;

        warnings.slackMessage("Static Image has been detected on RTV Slogo Stream since "+state.lastAudioFrame.toLocaleTimeString());
        warnings.emailMessage("Statisch beeld alarm voor RTV Slogo!",
        "Dit is een automatische waarschuwing van de stream monitor app.\n Het kanaal RTV Slogo heeft sinds "+state.lastVideoFrame.toLocaleTimeString()+" geen verandering van beeld gehad. \n\nU ontvangt hiervan geen melding meer totdat het geluid wordt hervat.")
 
        console.log('Static Image Warning!')
    }

    if (config.loudnessLogs && new Date().toLocaleTimeString() === '23:59:59') { // generate loudness report
        generateLogs()
    }
}, 1000)
