#!/usr/bin/env node
// supabase-helpers.mjs — Wrapper for Supabase bridge HTTP calls
// Used by all job-apply skills for data persistence.

const BRIDGE_URL = (process.env.SUPABASE_BRIDGE_URL || "http://127.0.0.1:18790").replace(/\/$/, "");
const AGENT_TOKEN = process.env.AGENT_TOKEN || "rvJ4Odm7EYmHOxbEtO6dwUIQLv55aYybAyU3uZw6880";

async function bridgeRequest(endpoint, body, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${BRIDGE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${AGENT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge ${endpoint} failed (${res.status}): ${text}`);
      }
      return res.json();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError;
}

// ─── Generic CRUD ────────────────────────────────────────────────

export async function query(table, opts = {}) {
  const result = await bridgeRequest("/query", { table, ...opts });
  return result?.data ?? result;
}

export async function insert(table, rows) {
  const result = await bridgeRequest("/insert", { table, rows: Array.isArray(rows) ? rows : [rows] });
  return result?.data ?? result;
}

export async function update(table, filters, data) {
  return bridgeRequest("/update", { table, filters, data });
}

export async function deleteRows(table, filters) {
  return bridgeRequest("/delete", { table, filters });
}

// ─── Resume Profile ──────────────────────────────────────────────

export async function getProfile() {
  const result = await query("documents", {
    filters: { category: { eq: "resume_profile" } },
    limit: 1,
  });
  return result?.[0] ?? null;
}

export async function saveProfile(profileData, title = "My Resume Profile") {
  const existing = await getProfile();
  if (existing) {
    await update("documents", { id: { eq: existing.id } }, {
      title,
      data: profileData,
      tags: ["resume", "profile"],
    });
    return { ...existing, data: profileData, title };
  }
  const rows = await insert("documents", {
    title,
    category: "resume_profile",
    data: profileData,
    tags: ["resume", "profile"],
  });
  return rows?.[0] ?? null;
}

// ─── Job Listings ────────────────────────────────────────────────

export async function saveJobListing(jobData) {
  const source = jobData.source || "unknown";
  const sourceId = jobData.source_id || jobData.url || "";

  // Deduplicate: check if we already have this job
  if (sourceId) {
    const existing = await query("documents", {
      filters: { category: { eq: "job_listing" } },
      select: ["id", "data"],
    });
    const dupe = (existing || []).find(
      (d) => d.data?.source_id === sourceId && d.data?.source === source
    );
    if (dupe) {
      return { duplicate: true, id: dupe.id };
    }
  }

  const rows = await insert("documents", {
    title: jobData.title || "Untitled Job",
    category: "job_listing",
    data: jobData,
    tags: ["job", source, jobData.status || "new"],
  });
  return rows?.[0] ?? null;
}

export async function getJobListings(filters = {}) {
  const queryFilters = { category: { eq: "job_listing" }, ...filters };
  return query("documents", {
    filters: queryFilters,
    order: { created_at: "desc" },
  });
}

export async function getJobById(id) {
  const result = await query("documents", {
    filters: { id: { eq: id } },
    limit: 1,
  });
  return result?.[0] ?? null;
}

// ─── Applications ────────────────────────────────────────────────

export async function saveApplication(appData) {
  const rows = await insert("documents", {
    title: `Application: ${appData.company || ""} - ${appData.job_title || ""}`,
    category: "job_application",
    data: appData,
    tags: ["application", appData.status || "submitted", appData.source || "unknown"],
  });
  return rows?.[0] ?? null;
}

export async function updateApplicationStatus(id, newStatus, extraData = {}) {
  await update("documents", { id: { eq: id } }, {
    data: { status: newStatus, ...extraData },
    tags: ["application", newStatus],
  });
}

export async function getApplications(filters = {}) {
  const queryFilters = { category: { eq: "job_application" }, ...filters };
  return query("documents", {
    filters: queryFilters,
    order: { created_at: "desc" },
  });
}

// ─── Config (key-value) ──────────────────────────────────────────

export async function getConfig(key) {
  const result = await query("key_value", {
    filters: { key: { eq: key } },
    limit: 1,
  });
  return result?.[0]?.value ?? null;
}

export async function setConfig(key, value) {
  const existing = await getConfig(key);
  if (existing !== null) {
    await update("key_value", { key: { eq: key } }, { value });
  } else {
    await insert("key_value", { key, value });
  }
}

// ─── Logging ─────────────────────────────────────────────────────

export async function logEvent(event, level = "info", detail = {}) {
  await insert("logs", { event, level, detail });
}

// ─── Credentials (for session auto-login) ───────────────────────

export async function getCredentials(site) {
  return getConfig(`credentials_${site}`);
}

export async function setCredentials(site, email, password) {
  await setConfig(`credentials_${site}`, {
    email,
    password,
    updated_at: new Date().toISOString(),
  });
}

// ─── CLI test ────────────────────────────────────────────────────

if (process.argv[2] === "--test") {
  try {
    const health = await fetch(`${BRIDGE_URL}/health`, {
      headers: { "Authorization": `Bearer ${AGENT_TOKEN}` },
    });
    console.log(JSON.stringify({
      success: true,
      bridge: health.ok ? "connected" : "error",
      status: health.status,
    }));
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message }));
  }
}
