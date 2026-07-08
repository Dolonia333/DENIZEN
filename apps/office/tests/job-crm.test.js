'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const CRM_FILE = path.join(ROOT, 'data', 'job-crm.json');
const OUTCOMES_FILE = path.join(ROOT, 'data', 'job-outcomes.json');

let jobCrm;
let crmBackup;
let outcomesBackup;
let tmpCrm;
let tmpOutcomes;

before(() => {
  if (fs.existsSync(CRM_FILE)) crmBackup = fs.readFileSync(CRM_FILE, 'utf8');
  if (fs.existsSync(OUTCOMES_FILE)) outcomesBackup = fs.readFileSync(OUTCOMES_FILE, 'utf8');
  tmpCrm = path.join(os.tmpdir(), `job-crm-test-${Date.now()}.json`);
  tmpOutcomes = path.join(os.tmpdir(), `job-outcomes-test-${Date.now()}.json`);
  fs.writeFileSync(tmpCrm, JSON.stringify({ applications: [], referrals: [], lastStandupAt: null }), 'utf8');
  fs.writeFileSync(tmpOutcomes, JSON.stringify({ stats: {}, events: [] }), 'utf8');
  fs.copyFileSync(tmpCrm, CRM_FILE);
  fs.copyFileSync(tmpOutcomes, OUTCOMES_FILE);
  delete require.cache[require.resolve('../src/pipelines/job-crm.js')];
  jobCrm = require('../src/pipelines/job-crm.js');
});

after(() => {
  if (crmBackup != null) fs.writeFileSync(CRM_FILE, crmBackup, 'utf8');
  else try { fs.unlinkSync(CRM_FILE); } catch (_) {}
  if (outcomesBackup != null) fs.writeFileSync(OUTCOMES_FILE, outcomesBackup, 'utf8');
  else try { fs.unlinkSync(OUTCOMES_FILE); } catch (_) {}
  try { fs.unlinkSync(tmpCrm); } catch (_) {}
  try { fs.unlinkSync(tmpOutcomes); } catch (_) {}
});

const profile = {
  skills: ['Python', 'JavaScript', 'Docker', 'AI', 'Node.js'],
  targetRoles: ['software engineer', 'ai engineer'],
  autofillDefaults: { remotePreference: 'remote' },
  minSalary: 90000,
};

describe('scoreListing', () => {
  it('scores a strong remote AI role highly', () => {
    const r = jobCrm.scoreListing(profile, {
      title: 'Senior AI Engineer',
      company: 'Acme',
      description: 'Python, Docker, remote-first AI platform',
      location: 'Remote',
    });
    assert.ok(r.score >= 7, `expected >= 7, got ${r.score}`);
    assert.equal(r.recommendation, 'apply');
  });

  it('skips weak role matches', () => {
    const r = jobCrm.scoreListing(profile, {
      title: 'Dental Hygienist',
      company: 'Clinic',
      description: 'patient care',
    });
    assert.ok(r.score < 5);
    assert.equal(r.recommendation, 'skip');
  });
});

describe('classifyJobEmail', () => {
  it('detects interview requests', () => {
    assert.equal(jobCrm.classifyJobEmail({
      subject: 'Re: Application',
      body: 'Would you be available for a phone screen next Tuesday?',
    }), 'interview_request');
  });

  it('detects offers', () => {
    assert.equal(jobCrm.classifyJobEmail({
      subject: 'Offer',
      body: 'We are pleased to offer you the position with a compensation package of...',
    }), 'offer');
  });

  it('returns null for unrelated mail', () => {
    assert.equal(jobCrm.classifyJobEmail({
      subject: 'Team lunch',
      body: 'Pizza at noon',
    }), null);
  });
});

describe('CRM storage', () => {
  it('upserts and lists applications', () => {
    const store = jobCrm.loadCrm();
    jobCrm.upsertApplication(store, {
      id: 'test-1', company: 'NovaTech', role: 'AI Engineer', status: 'applied', score: 8.5,
    });
    jobCrm.saveCrm(store);
    const listed = jobCrm.listApplications({ status: 'applied' });
    assert.ok(listed.some(a => a.id === 'test-1'));
  });

  it('builds a standup report', () => {
    const report = jobCrm.buildWeeklyStandup();
    assert.match(report, /standup/i);
  });
});
