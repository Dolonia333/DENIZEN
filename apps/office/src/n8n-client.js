'use strict';
/**
 * n8n REST API client — create/list/update workflows on the self-hosted NAS instance.
 *
 * Env:
 *   N8N_API_URL  default http://127.0.0.1:5679/api/v1  (use loopback on NAS)
 *   N8N_API_KEY  Settings → n8n API → Create API key
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const DEFAULT_TIMEOUT_MS = 30000;

function isConfigured(env = process.env) {
  return Boolean(String(env.N8N_API_KEY || '').trim() && String(env.N8N_API_URL || '').trim());
}

function config(env = process.env) {
  const baseUrl = String(env.N8N_API_URL || 'http://127.0.0.1:5679/api/v1').replace(/\/$/, '');
  const apiKey = String(env.N8N_API_KEY || '').trim();
  if (!apiKey) throw new Error('N8N_API_KEY not set');
  return { baseUrl, apiKey };
}

function requestJson(method, path, { body, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { baseUrl, apiKey } = config(env);
  const url = new URL(path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`);
  const payload = body == null ? null : JSON.stringify(body);
  const lib = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/json',
          'X-N8N-API-KEY': apiKey,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let parsed = null;
          if (raw) {
            try { parsed = JSON.parse(raw); } catch { parsed = raw; }
          }
          if (res.statusCode >= 400) {
            const msg = typeof parsed === 'object' && parsed?.message
              ? parsed.message
              : `n8n API ${res.statusCode}`;
            const err = new Error(msg);
            err.statusCode = res.statusCode;
            err.body = parsed;
            reject(err);
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('n8n API timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listWorkflows(opts = {}) {
  const limit = opts.limit == null ? 50 : opts.limit;
  const active = opts.active == null ? '' : `&active=${opts.active ? 'true' : 'false'}`;
  return requestJson('GET', `/workflows?limit=${limit}${active}`, { env: opts.env });
}

async function getWorkflow(id, opts = {}) {
  return requestJson('GET', `/workflows/${encodeURIComponent(id)}`, { env: opts.env });
}

async function createWorkflow(workflow, opts = {}) {
  const body = {
    name: workflow.name,
    nodes: workflow.nodes || [],
    connections: workflow.connections || {},
    settings: workflow.settings || { executionOrder: 'v1' },
  };
  if (workflow.staticData != null) body.staticData = workflow.staticData;
  return requestJson('POST', '/workflows', { body, env: opts.env });
}

async function updateWorkflow(id, workflow, opts = {}) {
  const body = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
  };
  return requestJson('PUT', `/workflows/${encodeURIComponent(id)}`, { body, env: opts.env });
}

async function setWorkflowActive(id, active, opts = {}) {
  const path = active ? `/workflows/${encodeURIComponent(id)}/activate` : `/workflows/${encodeURIComponent(id)}/deactivate`;
  return requestJson('POST', path, { env: opts.env });
}

async function importWorkflowFromTemplate(template, opts = {}) {
  const {
    name = template.name,
    url,
    secret,
    stripCredentials = true,
  } = opts;

  const nodes = JSON.parse(JSON.stringify(template.nodes || []));
  for (const node of nodes) {
    if (stripCredentials) node.credentials = undefined;
    if (node.name === 'POST → Denizen /api/email-inbound' && url) {
      node.parameters = node.parameters || {};
      node.parameters.url = url;
      const headers = node.parameters.headerParameters?.parameters;
      if (Array.isArray(headers) && secret) {
        for (const hp of headers) {
          if (hp.name === 'X-Denizen-Secret') hp.value = secret;
        }
      }
    }
  }

  return createWorkflow({
    name,
    nodes,
    connections: template.connections || {},
    settings: template.settings || { executionOrder: 'v1' },
  }, { env: opts.env });
}

module.exports = {
  isConfigured,
  config,
  requestJson,
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  setWorkflowActive,
  importWorkflowFromTemplate,
};
