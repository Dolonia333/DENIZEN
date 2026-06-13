#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '..', 'dist');
const htmlPath = path.join(dist, 'index.html');

if (!fs.existsSync(htmlPath)) {
  console.error('CRM dist/index.html missing — run npm run build:crm first');
  process.exit(1);
}

const DEFERRED = /recharts|SalesSection|NotesTab|ScheduleSection|GlobalTeamChat|DashboardCharts/i;

let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/<link rel="modulepreload"[^>]*recharts[^>]*>\s*/gi, '');
fs.writeFileSync(htmlPath, html);

const js = [...html.matchAll(/(?:src|href)="(\/crm\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const css = [...html.matchAll(/href="(\/crm\/assets\/[^"]+\.css)"/g)].map((m) => m[1]);
const unique = (list) => [...new Set(list)];
const allJs = unique(js);

const manifest = {
  js: allJs,
  critical: allJs.filter((href) => !DEFERRED.test(href)),
  deferred: allJs.filter((href) => DEFERRED.test(href)),
  css: unique(css),
  entry: allJs[0] || null,
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`CRM manifest: ${manifest.critical.length} critical js, ${manifest.deferred.length} deferred js, ${manifest.css.length} css`);
