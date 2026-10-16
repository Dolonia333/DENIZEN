'use strict';

/**
 * Desktop compute runner — single source of truth is denizen-mesh-job-runner.
 * (aislop: unify desktop + runtime job execution)
 */
const mesh = require('../src/denizen-mesh-job-runner');

async function processJobLocally(jobType, payload = {}, ctx = {}) {
  return mesh.processMeshJob(jobType, payload, ctx);
}

module.exports = {
  processJobLocally,
  processMeshJob: mesh.processMeshJob,
  isInferenceReachable: mesh.isInferenceReachable,
};
