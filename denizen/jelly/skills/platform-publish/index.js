'use strict';

const fs = require('node:fs');
const path = require('node:path');

function slugify(title) {
  return String(title || 'post')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';
}

async function publishSupabase({ title, content, status, table, excerpt }) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!base || !key) return null;

  const cmsTable = table || process.env.PLATFORM_CMS_TABLE || 'blog_posts';
  const row = {
    title,
    slug: slugify(title),
    body: content,
    content,
    excerpt: excerpt || content.slice(0, 280),
    status: status === 'publish' ? 'published' : (status || 'draft'),
    published_at: status === 'publish' ? new Date().toISOString() : null,
  };

  const res = await fetch(`${base}/rest/v1/${encodeURIComponent(cmsTable)}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, mode: 'supabase', error: `${res.status} ${text.slice(0, 400)}`, table: cmsTable };
  }
  let data;
  try { data = JSON.parse(text); } catch { data = []; }
  const rec = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    mode: 'supabase',
    table: cmsTable,
    id: rec?.id,
    slug: rec?.slug || row.slug,
    url: rec?.url || rec?.canonical_url || null,
  };
}

function publishLocalExport({ title, content, status }) {
  const root = process.env.PLATFORM_SITE_EXPORT_DIR || process.env.LOVABLE_SITE_DIR || '';
  if (!root || !fs.existsSync(root)) return null;

  const dir = path.join(root, 'content', 'posts');
  fs.mkdirSync(dir, { recursive: true });
  const slug = slugify(title);
  const file = path.join(dir, `${slug}.md`);
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `status: ${JSON.stringify(status || 'draft')}`,
    `date: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(file, frontmatter + content, 'utf8');
  return { ok: true, mode: 'local', path: file, slug };
}

module.exports = {
  meta: {
    name: 'platform-publish',
    description: 'Publish content to Supabase CMS table or local Lovable export folder',
    mode: 'background',
    aliases: ['cms-publish', 'lovable-publish', 'site-publish'],
  },
  async run({ params }) {
    const title = String(params?.title || 'Untitled').trim();
    const content = String(params?.content || params?.body || params?.html || '').trim();
    const status = String(params?.status || process.env.PLATFORM_DEFAULT_STATUS || 'draft').trim();
    const excerpt = params?.excerpt ? String(params.excerpt) : '';

    const attempts = [];

    const sb = await publishSupabase({ title, content, status, table: params?.table, excerpt }).catch((e) => ({
      ok: false, mode: 'supabase', error: e.message,
    }));
    if (sb) attempts.push(sb);

    const local = publishLocalExport({ title, content, status });
    if (local) attempts.push(local);

    const wpUrl = (process.env.WORDPRESS_URL || '').replace(/\/$/, '');
    if (wpUrl && process.env.WORDPRESS_USERNAME && process.env.WORDPRESS_APP_PASSWORD) {
      try {
        const auth = Buffer.from(`${process.env.WORDPRESS_USERNAME}:${process.env.WORDPRESS_APP_PASSWORD}`).toString('base64');
        const res = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, status }),
        });
        const text = await res.text();
        attempts.push({
          ok: res.ok,
          mode: 'wordpress',
          detail: text.slice(0, 300),
        });
      } catch (err) {
        attempts.push({ ok: false, mode: 'wordpress', error: err.message });
      }
    }

    const winner = attempts.find((a) => a.ok);
    if (winner) {
      const lines = [
        '# Published',
        '',
        `**Mode:** ${winner.mode}`,
        winner.table ? `**Table:** ${winner.table}` : '',
        winner.path ? `**File:** ${winner.path}` : '',
        winner.slug ? `**Slug:** ${winner.slug}` : '',
        winner.url ? `**URL:** ${winner.url}` : '',
        winner.id ? `**ID:** ${winner.id}` : '',
      ].filter(Boolean);
      return { ok: true, output: lines.join('\n'), skill: 'platform-publish', inject: true, ...winner };
    }

    const preview = [
      '# Publish (dry-run)',
      '',
      'No Supabase CMS table, local site export dir, or WordPress Docker credentials configured.',
      '',
      'Set one of:',
      '- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `PLATFORM_CMS_TABLE` (default blog_posts)',
      '- `PLATFORM_SITE_EXPORT_DIR` or `LOVABLE_SITE_DIR` → writes content/posts/*.md',
      '- `WORDPRESS_URL` on Synology Docker (optional future)',
      '',
      `**Title:** ${title}`,
      `**Status:** ${status}`,
      '',
      content.slice(0, 1800) || '(empty body)',
      '',
      '_Attempts:_',
      ...attempts.map((a) => `- ${a.mode}: ${a.error || a.detail || 'failed'}`),
    ].join('\n');

    return { ok: true, output: preview, skill: 'platform-publish', dryRun: true, inject: true };
  },
};
