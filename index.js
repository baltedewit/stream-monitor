const ffmpeg = require('fluent-ffmpeg');
const Slack = require('slack-node');
const email = require('emailjs');
const config = requite('./config.json')
 
const WEBHOOK = "https://hooks.slack.com/services/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";
const STREAM = "http://media.streamone.net/hlslive/account=gCRIPoIbRB0W/livestream=rrIMh6YQSxQW/rrIMh6YQSxQW.m3u8";
 
const slack = new Slack();
slack.setWebhook(WEBHOOK);

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

let cmd = new ffmpeg(STREAM)
    .native()
    .complexFilter('ebur128=peak=true')
    .videoFilter("select='gt(scene,0.1)',showinfo")
    .format('null')
    // .outputFPS(1)
    .output('-');

cmd.on('start', (cmdLine) => {
    console.log('started with ' + cmdLine);
});

cmd.on('stderr', (line) => {
    let segments = line.split(' ');
    if (segments[0].indexOf('[Parsed_ebur128') == 0) {
        parseEbuMessage(segments);
    } else if (segments[0].indexOf('[Parsed_showinfo_1') == 0) {
        handleSceneChangeMessage(segments);
    }
});

cmd.run();

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

function resetSilenceWarning() {
    state.silenceWarningSent = false;

    slack.webhook({
        channel: "#techniek",
        username: "Stream Watcher",
        text: "Audio resumed on RTV Slogo at "+new Date().toLocaleTimeString()
      }, function () {
          //
      });
}

function handleSceneChangeMessage(segments) {
    state.staticImageWarningSent = false;
    state.lastVideoFrame = new Date();
}

function handleEbuMessage(object) {
    if (object.frameTPK[0] > -70) { // true peak in dbFS
        if (state.silenceWarningSent) {
            resetSilenceWarning();
        }
        state.lastAudioFrame = new Date();
    }
}

// run checks every second
setInterval(function () {
    if (!state.connected)
        return;

    if (!state.silenceWarningSent && new Date() - state.lastAudioFrame > 30*1000) { // silence for 30 seconds
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
            // bcc:     "Balte de Wit <contact@balte.nl>, Jeroen Kik <email@jeroenkik.nl>, Emile Koole <emilekoole@gmail.com>",
            subject: "[STREAM MONITOR] Stilte alarm voor RTV Slogo!"
         }, function(err, message) { console.log(err || message); });

        console.log('Silence Warning!')
    }

    if (!state.staticImageWarningSent && new Date() - state.lastVideoFrame > 30*1000) { // static image for 30 seconds
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
            // bcc:     "Balte de Wit <contact@balte.nl>, Jeroen Kik <email@jeroenkik.nl>, Emile Koole <emilekoole@gmail.com>",
            subject: "[STREAM MONITOR] Statisch beeld alarm voor RTV Slogo!"
         }, function(err, message) { console.log(err || message); });

        console.log('Static Image Warning!')
    }
}, 1000)