const config = require('./config.json');
const email = require('emailjs');
const Slack = require('slack-node');
const os = require('os');

const warnings = {};
const slack = new Slack();
slack.setWebhook(config.webhook);

const emailServer = email.server.connect({
    user: config.user,
    password: config.password,
    host: config.host,
    ssl: true
});

warnings.slackMessage = function (message, cb) {
    slack.webhook({
        channel: "#techniek",
        username: "Stream Watcher",
        text: os.hostname+": "+message
    }, function () {
        if (cb && typeof cb == "function") {
            cb();
        }
    });
}

warnings.emailMessage = function (subject, message) {
    emailServer.send({
        text:    message, 
        from:    "Stream Monitor <"+config.user+">", 
        to:      "Stream Monitor <"+config.user+">", 
        bcc:     config.recipients,
        subject: "[STREAM MONITOR] "+subject
    }, function(err, message) { console.log(err || message); });
}

module.exports = warnings;