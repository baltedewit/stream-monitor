const ffmpeg = require('fluent-ffmpeg');
const Slack = require('slack-node');
const email = require('emailjs');
const config = require('./config.json');
 
const slack = new Slack();
slack.setWebhook(config.webhook);

const emailServer = email.server.connect({
    user: config.user,
    password: config.password,
    host: config.host,
    ssl: true
});

const state = {
    lastAudioFrame: new Date(),
    silenceWarningSent: false,
    lastVideoFrame: new Date(),
    staticImageWarningSent: false,
    connected: 0
}

const frameHistory = [];

/**
 * Set up command & start ffmpeg.
 */
let cmd = new ffmpeg(config.stream)
    .native()
    .outputOptions(config.mappings)
    .complexFilter('ebur128=peak=true')
    .videoFilter("select='gt(scene,0)',showinfo")
    .format('null')
    .output('-');

cmd.on('start', (cmdLine) => {
    console.log('started with ' + cmdLine);
});

cmd.on('stderr', (line) => {
    let segments = line.split(' ');
    if (segments[0].indexOf('[Parsed_ebur128') == 0) {
        parseEbuMessage(segments);
    } else if (segments[0].indexOf('[Parsed_showinfo_1') == 0) {
        parseSceneChangeMessage(segments);
    }
});

cmd.run();

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

    slack.webhook({
        channel: "#techniek",
        username: "Stream Watcher",
        text: "Audio resumed on RTV Slogo at "+new Date().toLocaleTimeString()
    }, function () {
          //
    });

    emailServer.send({
        text:    "Dit is een automatisch bericht van de stream monitor app.\n Het kanaal RTV Slogo is om "+Date.new().toLocaleTimeString()+" herstart met het uitzenden van geluid.", 
        from:    "Balte de Wit <balte.de.wit@rtvslogo.nl>", 
        to:      "Balte de Wit <balte.de.wit@rtvslogo.nl>",
        bcc:     "Balte de Wit <contact@balte.nl>, Jeroen Kik <email@jeroenkik.nl>, Emile Koole <emilekoole@gmail.com>",
        subject: "[STREAM MONITOR] Opheffing stilte alarm voor RTV Slogo"
    }, function(err, message) { console.log(err || message); });
}

function resetStaticImageWarning() {
    state.staticImageWarningSent = false;

    slack.webhook({
        channel: "#techniek",
        username: "Stream Watcher",
        text: "Video resumed on RTV Slogo at "+new Date().toLocaleTimeString()
    }, function () {
          //
    });

    emailServer.send({
        text:    "Dit is een automatisch bericht van de stream monitor app.\n Het kanaal RTV Slogo is om "+new Date().toLocaleTimeString()+" herstart met het uitzenden van beeld.", 
        from:    "Balte de Wit <balte.de.wit@rtvslogo.nl>", 
        to:      "Balte de Wit <balte.de.wit@rtvslogo.nl>",
        bcc:     "Balte de Wit <contact@balte.nl>, Jeroen Kik <email@jeroenkik.nl>, Emile Koole <emilekoole@gmail.com>",
        subject: "[STREAM MONITOR] Statisch beeld alarm voor RTV Slogo"
    }, function(err, message) { console.log(err || message); });
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

// run checks every second
setInterval(function () {
    if (!state.connected)
        return;

    calculateMotion();

    if (!state.silenceWarningSent && new Date() - state.lastAudioFrame > config.audioTimeout*1000) { // silence for 30 seconds
        state.silenceWarningSent = true;
 
        slack.webhook({
          channel: "#techniek",
          username: "Stream Watcher",
          text: "No audio on RTV Slogo Stream since "+state.lastAudioFrame.toLocaleTimeString()
        }, function () {
            //
        });

        emailServer.send({
            text:    "Dit is een automatische waarschuwing van de stream monitor app.\n Het kanaal RTV Slogo is sinds "+state.lastAudioFrame.toLocaleTimeString()+" stil geweest. \n\nU ontvangt hiervan geen melding meer totdat het geluid wordt hervat.", 
            from:    "Balte de Wit <balte.de.wit@rtvslogo.nl>", 
            to:      "Balte de Wit <balte.de.wit@rtvslogo.nl>",
            bcc:     "Balte de Wit <contact@balte.nl>, Jeroen Kik <email@jeroenkik.nl>, Emile Koole <emilekoole@gmail.com>",
            subject: "[STREAM MONITOR] Stilte alarm voor RTV Slogo!"
         }, function(err, message) { console.log(err || message); });

        console.log('Silence Warning!')
    }

    if (!state.staticImageWarningSent && new Date() - state.lastVideoFrame > config.videoTimeout*1000) { // static image for 30 seconds
        state.staticImageWarningSent = true;

        slack.webhook({
            channel: "#techniek",
            username: "Stream Watcher",
            text: "Static Image has been detected on RTV Slogo Stream since "+state.lastAudioFrame.toLocaleTimeString()
        }, function () {
            //
        });
        
        emailServer.send({
            text:    "Dit is een automatische waarschuwing van de stream monitor app.\n Het kanaal RTV Slogo heeft sinds "+state.lastVideoFrame.toLocaleTimeString()+" geen verandering van beeld gehad. \n\nU ontvangt hiervan geen melding meer totdat het beeld wordt hervat.", 
            from:    "Balte de Wit <balte.de.wit@rtvslogo.nl>", 
            to:      "Balte de Wit <balte.de.wit@rtvslogo.nl>",
            bcc:     "Balte de Wit <contact@balte.nl>, Jeroen Kik <email@jeroenkik.nl>, Emile Koole <emilekoole@gmail.com>",
            subject: "[STREAM MONITOR] Statisch beeld alarm voor RTV Slogo!"
         }, function(err, message) { console.log(err || message); });

        console.log('Static Image Warning!')
    }
}, 1000)