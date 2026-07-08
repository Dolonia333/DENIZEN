'use strict';

const { processMeshJob } = require('../src/compute/denizen-mesh-job-runner');

/** Desktop-local job execution (no server DB deps). */
async function processJobLocally(jobType, payload = {}) {
  return processMeshJob(jobType, payload);
}

module.exports = { processJobLocally };
