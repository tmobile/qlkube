const log = require('pino')({ useLevelLabels: true });

// https://github.com/pinojs/pino/blob/master/docs/api.md#loggerlevel-string-gettersetter
// Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace";
log.level = "debug";
if (process.env.LOG_LEVEL) {
    log.level = process.env.LOG_LEVEL;
}
module.exports = {
    logger: log
};
