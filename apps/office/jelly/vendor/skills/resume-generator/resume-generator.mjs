#!/usr/bin/env node
// resume-generator.mjs — Generate tailored HTML/PDF resumes from profile + job data
// Loads an HTML template, injects profile data, tailors to job description.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENCLAW_ROOT = resolve(__dirname, "..", "..");
const CANVAS_DIR = join(homedir(), ".openclaw", "canvas");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith("--") && i + 1 < argv.length) {
      args[key.slice(2)] = argv[++i];
    }
  }
  return args;
}

function loadTemplate(templateName) {
  const templatePath = join(__dirname, "assets", `template-${templateName}.html`);
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}. Available: modern, minimal, executive`);
  }
  return readFileSync(templatePath, "utf-8");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Extract keywords from a job description for tailoring.
 */
function extractKeywords(jobText) {
  if (!jobText) return [];
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "can", "shall", "must", "need",
    "we", "you", "your", "our", "their", "this", "that", "these", "those",
    "it", "its", "as", "if", "not", "no", "all", "each", "every", "any",
    "about", "up", "out", "so", "than", "too", "very", "just", "also",
    "work", "working", "job", "role", "position", "company", "team",
    "experience", "years", "ability", "strong", "excellent", "good",
  ]);

  const words = jobText.toLowerCase().match(/[a-z][a-z+#.]{1,30}/g) || [];
  const freq = {};
  for (const w of words) {
    if (!stopWords.has(w) && w.length > 2) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([word]) => word);
}

/**
 * Score a bullet point against job keywords (higher = more relevant).
 */
function scoreBullet(bullet, keywords) {
  const lower = bullet.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += 1;
  }
  return score;
}

/**
 * Reorder bullets by relevance to job keywords.
 */
function reorderBullets(bullets, keywords) {
  if (!keywords.length) return bullets;
  return [...bullets].sort((a, b) => scoreBullet(b, keywords) - scoreBullet(a, keywords));
}

/**
 * Determine which skills match the job description.
 */
function matchSkills(allSkills, keywords) {
  const matched = [];
  const other = [];
  for (const skill of allSkills) {
    if (keywords.some((kw) => skill.toLowerCase().includes(kw) || kw.includes(skill.toLowerCase()))) {
      matched.push(skill);
    } else {
      other.push(skill);
    }
  }
  return { matched, other };
}

/**
 * Inject profile data into template using {{token}} replacement.
 */
function renderTemplate(template, profile, job, keywords) {
  const p = profile.personal || {};
  const allSkills = [
    ...(profile.skills?.languages || []),
    ...(profile.skills?.frameworks || []),
    ...(profile.skills?.tools || []),
    ...(profile.skills?.other || []),
  ];
  const { matched: matchedSkills, other: otherSkills } = matchSkills(allSkills, keywords);
  const skillsHtml = [
    ...matchedSkills.map((s) => `<span class="skill matched">${escapeHtml(s)}</span>`),
    ...otherSkills.map((s) => `<span class="skill">${escapeHtml(s)}</span>`),
  ].join("\n");

  // Build experience HTML
  const experienceHtml = (profile.experience || [])
    .map((exp) => {
      const bullets = reorderBullets(exp.bullets || [], keywords);
      const bulletsHtml = bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("\n");
      const dates = `${exp.start_date || ""} – ${exp.end_date || "Present"}`;
      return `
      <div class="experience-item">
        <div class="exp-header">
          <div class="exp-title">${escapeHtml(exp.title)}</div>
          <div class="exp-dates">${escapeHtml(dates)}</div>
        </div>
        <div class="exp-company">${escapeHtml(exp.company)}${exp.location ? ` · ${escapeHtml(exp.location)}` : ""}</div>
        <ul class="exp-bullets">${bulletsHtml}</ul>
      </div>`;
    })
    .join("\n");

  // Build education HTML
  const educationHtml = (profile.education || [])
    .map((edu) => {
      return `
      <div class="education-item">
        <div class="edu-header">
          <div class="edu-degree">${escapeHtml(edu.degree)}</div>
          <div class="edu-date">${escapeHtml(edu.graduation_date || "")}</div>
        </div>
        <div class="edu-school">${escapeHtml(edu.school)}${edu.gpa ? ` · GPA: ${escapeHtml(edu.gpa)}` : ""}</div>
      </div>`;
    })
    .join("\n");

  // Build certifications HTML
  const certsHtml = (profile.certifications || [])
    .map((c) => `<div class="cert-item">${escapeHtml(c.name)} – ${escapeHtml(c.issuer || "")} (${escapeHtml(c.date || "")})</div>`)
    .join("\n");

  // Build projects HTML
  const projectsHtml = (profile.projects || [])
    .map((proj) => {
      const techStr = (proj.technologies || []).join(", ");
      return `
      <div class="project-item">
        <div class="proj-name">${escapeHtml(proj.name)}${proj.url ? ` <a href="${escapeHtml(proj.url)}">[link]</a>` : ""}</div>
        <div class="proj-desc">${escapeHtml(proj.description)}</div>
        ${techStr ? `<div class="proj-tech">${escapeHtml(techStr)}</div>` : ""}
      </div>`;
    })
    .join("\n");

  // Token replacements
  const tokens = {
    "{{name}}": escapeHtml(p.name || ""),
    "{{email}}": escapeHtml(p.email || ""),
    "{{phone}}": escapeHtml(p.phone || ""),
    "{{location}}": escapeHtml(p.location || ""),
    "{{linkedin}}": escapeHtml(p.linkedin || ""),
    "{{github}}": escapeHtml(p.github || ""),
    "{{website}}": escapeHtml(p.website || ""),
    "{{summary}}": escapeHtml(p.summary || ""),
    "{{skills}}": skillsHtml,
    "{{experience}}": experienceHtml,
    "{{education}}": educationHtml,
    "{{certifications}}": certsHtml,
    "{{projects}}": projectsHtml,
    "{{job_title}}": escapeHtml(job?.title || ""),
    "{{company}}": escapeHtml(job?.company || ""),
  };

  let result = template;
  for (const [token, value] of Object.entries(tokens)) {
    result = result.replaceAll(token, value);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);

  const profileArg = args.profile;
  const jobArg = args.job;
  const templateName = args.template || "modern";
  const outputHtml = args.output ? resolve(args.output) : null;
  const outputPdf = args.pdf ? resolve(args.pdf) : null;

  if (!profileArg) {
    console.log(JSON.stringify({
      success: false,
      error: "Usage: node resume-generator.mjs --profile <json_or_path> --job <json_or_path> --template modern|minimal|executive --output <html_path> [--pdf <pdf_path>]",
    }));
    process.exit(1);
  }

  // Load profile (JSON string or file path)
  let profile;
  try {
    if (existsSync(profileArg)) {
      profile = JSON.parse(readFileSync(profileArg, "utf-8"));
    } else {
      profile = JSON.parse(profileArg);
    }
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: `Failed to parse profile: ${err.message}` }));
    process.exit(1);
  }

  // Load job (optional, JSON string or file path)
  let job = null;
  if (jobArg) {
    try {
      if (existsSync(jobArg)) {
        job = JSON.parse(readFileSync(jobArg, "utf-8"));
      } else {
        job = JSON.parse(jobArg);
      }
    } catch (err) {
      console.log(JSON.stringify({ success: false, error: `Failed to parse job: ${err.message}` }));
      process.exit(1);
    }
  }

  // Extract keywords for tailoring
  const jobText = job ? `${job.title || ""} ${job.description || ""} ${(job.requirements || []).join(" ")}` : "";
  const keywords = extractKeywords(jobText);

  // Load and render template
  let template;
  try {
    template = loadTemplate(templateName);
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }

  const html = renderTemplate(template, profile, job, keywords);

  // Write HTML output
  const htmlPath = outputHtml || join(CANVAS_DIR, "resume-preview.html");
  const htmlDir = dirname(htmlPath);
  if (!existsSync(htmlDir)) mkdirSync(htmlDir, { recursive: true });
  writeFileSync(htmlPath, html, "utf-8");

  const result = {
    success: true,
    html_path: htmlPath,
    template: templateName,
    tailoring_notes: keywords.length > 0
      ? `Tailored for: ${keywords.slice(0, 10).join(", ")}. ${keywords.length} keywords matched.`
      : "Generic resume (no job description provided for tailoring).",
  };

  // Optionally generate PDF using pdf-generator
  if (outputPdf) {
    try {
      const pdfScript = join(OPENCLAW_ROOT, "skills", "pdf-generator", "pdf-generator.mjs");
      const pdfResult = execFileSync("node", [
        pdfScript,
        "--file", htmlPath,
        "--output", outputPdf,
        "--format", "Letter",
        "--margin", "0",
        "--screenshot", "true",
        "--canvasDir", CANVAS_DIR,
      ], { cwd: OPENCLAW_ROOT, timeout: 60000, encoding: "utf-8" });
      const parsed = JSON.parse(pdfResult.trim());
      if (parsed.success) {
        result.pdf_path = parsed.path;
        result.screenshot_path = parsed.screenshotPath;
        result.preview_url = parsed.previewUrl;
      }
    } catch (err) {
      result.pdf_error = `PDF generation failed: ${err.message}`;
    }
  }

  console.log(JSON.stringify(result));
}

main();
