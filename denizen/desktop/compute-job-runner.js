'use strict';

const { processMeshJob } = require('../src/denizen-mesh-job-runner');

/** Desktop-local job execution (no server DB deps). */
async function processJobLocally(jobType, payload = {}) {
  return processMeshJob(jobType, payload);
}

module.exports = { processJobLocally };
