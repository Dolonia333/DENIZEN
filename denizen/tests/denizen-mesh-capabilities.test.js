'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const caps = require('../src/denizen-mesh-capabilities.js');
const computeQueue = require('../src/denizen-compute-queue.js');

describe('denizen-mesh-capabilities', () => {
  it('jobRequirements returns floors for known job types', () => {
    const inference = caps.jobRequirements('inference_rpc');
    assert.equal(inference.minHardwareScore, 12);
    assert.equal(inference.minVramMb, 4096);
    assert.equal(inference.prefersGpu, true);

    const think = caps.jobRequirements('npc_think_batch');
    assert.equal(think.minHardwareScore, 16);
    assert.ok(think.minVramMb >= 2048);
    assert.equal(think.prefersGpu, true);

    const search = caps.jobRequirements('web_search');
    assert.equal(search.minHardwareScore, 0);
    assert.equal(search.minVramMb, 0);
    assert.equal(search.prefersGpu, false);

    const coding = caps.jobRequirements('coding-agent-ish');
    assert.ok(coding.minHardwareScore >= 0);
    assert.equal(coding.prefersGpu, false);

    const unknown = caps.jobRequirements('totally_unknown_job');
    assert.deepEqual(unknown, {
      minHardwareScore: 0,
      minVramMb: 0,
      prefersGpu: false,
    });
  });

  it('nodeCanClaim rejects offline / contribution off nodes', () => {
    const req = caps.jobRequirements('web_search');
    assert.equal(caps.nodeCanClaim({ hardware_score: 50, status: 'offline' }, req).ok, false);
    assert.equal(
      caps.nodeCanClaim({ hardware_score: 50, status: 'disconnected' }, req).reason,
      'node_offline',
    );
    assert.equal(caps.nodeCanClaim({ hardware_score: 50, offline: true }, req).ok, false);
    assert.equal(caps.nodeCanClaim({ hardware_score: 50, contribution_level: 'off' }, req).ok, false);
    assert.equal(caps.nodeCanClaim({ hardware_score: 50, online: false }, req).ok, false);
    assert.equal(caps.nodeCanClaim({ hardware_score: 50, reachable: false }, req).ok, false);
    assert.equal(caps.nodeCanClaim({ hardware_score: 10, contribution_level: 'standard' }, req).ok, true);
  });

  it('nodeCanClaim rejects weak hardware for heavy GPU jobs', () => {
    const req = caps.jobRequirements('inference_rpc');
    const weak = { hardware_score: 4, contribution_level: 'standard' };
    const mid = { hardware_score: 20, contribution_level: 'standard' };
    assert.equal(caps.nodeCanClaim(weak, req).ok, false);
    assert.match(caps.nodeCanClaim(weak, req).reason, /hardware_score/);
    assert.equal(caps.nodeCanClaim(mid, req).ok, true);
  });

  it('nodeCanClaim enforces VRAM floor when VRAM is reported', () => {
    const req = caps.jobRequirements('inference_rpc');
    const lowVram = {
      hardware_score: 40,
      vram_mb: 2048,
      contribution_level: 'standard',
    };
    const enoughVram = {
      hardware_score: 40,
      vram_mb: 8192,
      contribution_level: 'standard',
    };
    // Score-only node (unknown VRAM) still passes — score gate alone
    const scoreOnly = { hardware_score: 40, contribution_level: 'standard' };

    assert.equal(caps.nodeCanClaim(lowVram, req).ok, false);
    assert.match(caps.nodeCanClaim(lowVram, req).reason, /vram_mb/);
    assert.equal(caps.nodeCanClaim(enoughVram, req).ok, true);
    assert.equal(caps.nodeCanClaim(scoreOnly, req).ok, true);
  });

  it('rankNodes filters ineligible and sorts strongest first', () => {
    const req = caps.jobRequirements('npc_think_batch');
    const nodes = [
      { machine_id: 'weak', hardware_score: 4, vram_mb: 1024 },
      { machine_id: 'gpu-b', hardware_score: 30, vram_mb: 8192 },
      { machine_id: 'gpu-a', hardware_score: 50, vram_mb: 16384 },
      { machine_id: 'offline', hardware_score: 90, status: 'offline', vram_mb: 24000 },
      { machine_id: 'low-vram', hardware_score: 40, vram_mb: 512 },
    ];
    const ranked = caps.rankNodes(nodes, req);
    assert.deepEqual(
      ranked.map((n) => n.machine_id),
      ['gpu-a', 'gpu-b'],
    );
  });

  it('rankNodes prefers higher VRAM on score ties when prefersGpu', () => {
    const req = caps.jobRequirements('inference_rpc');
    const nodes = [
      { machine_id: 'less-vram', hardware_score: 30, vram_mb: 4096 },
      { machine_id: 'more-vram', hardware_score: 30, vram_mb: 12288 },
    ];
    const ranked = caps.rankNodes(nodes, req);
    assert.equal(ranked[0].machine_id, 'more-vram');
    assert.equal(ranked[1].machine_id, 'less-vram');
  });

  it('requirementsForJob honors payload overrides', () => {
    const job = {
      job_type: 'web_search',
      payload: { required_hardware_score: 20, required_vram_mb: 1000 },
    };
    const req = caps.requirementsForJob(job);
    assert.equal(req.minHardwareScore, 20);
    assert.equal(req.minVramMb, 1000);
  });

  it('compute-queue nodeCanRunJob uses mesh capabilities (weak skip heavy)', () => {
    const heavy = { job_type: 'embedding_index', payload: {} };
    const weak = { hardware_score: 8, contribution_level: 'standard' };
    const strong = { hardware_score: 40, contribution_level: 'standard', vram_mb: 16384 };
    assert.equal(computeQueue.nodeCanRunJob(weak, heavy), false);
    assert.equal(computeQueue.nodeCanRunJob(strong, heavy), true);

    const inference = { job_type: 'inference_rpc', payload: {} };
    assert.equal(
      computeQueue.nodeCanRunJob(
        { hardware_score: 40, vram_mb: 1024, contribution_level: 'standard' },
        inference,
      ),
      false,
    );
    assert.equal(
      computeQueue.nodeCanRunJob(
        { hardware_score: 40, vram_mb: 8192, contribution_level: 'standard' },
        inference,
      ),
      true,
    );
  });

  it('compute-queue re-exports mesh helpers', () => {
    assert.equal(typeof computeQueue.jobRequirements, 'function');
    assert.equal(typeof computeQueue.nodeCanClaim, 'function');
    assert.equal(typeof computeQueue.rankNodes, 'function');
    assert.equal(computeQueue.JOB_MIN_HARDWARE_SCORE.inference_rpc, 12);
  });
});
