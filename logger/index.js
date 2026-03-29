const pino = require('pino');

const logger = new pino({
  level: 'debug',
  base: {
    pid: undefined,
    hostname: undefined,
  },
  enabled: true
});

module.exports = logger;