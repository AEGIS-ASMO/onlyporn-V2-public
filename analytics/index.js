let analytics = null

if (process.env.SEGMENT_WRITE_KEY) {
  const { Analytics } = require('@segment/analytics-node')
  analytics = new Analytics({
    writeKey: process.env.SEGMENT_WRITE_KEY
  })
}

module.exports = analytics