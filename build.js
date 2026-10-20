#!/usr/bin/env node
/**
 * Static site generator for machikohirota.com-style personal homepage.
 *
 * Reads content/*.json and content/bio.*.md, writes dist/index.html (English)
 * and dist/ja/index.html (Japanese) plus static assets. No dependencies.
 *
 *   node build.js            build into dist/
 *   node build.js --serve    build, then serve dist/ at http://localhost:8080
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');
const LANGS = ['en', 'ja'];
const warnings = [];
let PREFIX = ''; // relative path back to the site root for the page being rendered

// Internal links are stored site-relative (e.g. "files/slides.pdf"); external ones
// are left alone.
const href = (u = '') => (/^(https?:|mailto:|#|\/)/.test(u) ? u : PREFIX + u);

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJSON = (p) => JSON.parse(read(p));

const site = readJSON('content/site.json');
const research = readJSON('content/research.json');
const bios = { en: read('content/bio.en.md'), ja: read('content/bio.ja.md') };

/* ---------- tiny helpers ------------------------------------------ */

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Inline markdown only: [text](url), **strong**, *em*.
const inline = (s = '') =>
  esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

// Paragraphs, plus "* " bullet lists. A block whose every line starts with "* "
// becomes a <ul>; anything else is a paragraph with its line breaks collapsed.
const markdown = (src) =>
  src
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => l.startsWith('* '))) {
        const items = lines
          .map((l) => `<li>${inline(l.slice(2).trim())}</li>`)
          .join('\n            ');
        return `<ul>\n            ${items}\n          </ul>`;
      }
      return `<p>${inline(block.replace(/\s*\n\s*/g, ' ').trim())}</p>`;
    })
    .join('\n        ');

// Pick the value for a language: accepts a plain string or an {en, ja} object.
const L = (v, lang) => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[lang] || v.en || '';
};

const isDraft = (e) => e.draft === true;

/* ---------- fragments --------------------------------------------- */

function authorsHTML(authors = []) {
  if (!authors.length) return '';
  const me = research.authorHighlight;
  return authors
    .map((a) => {
      const [, name, mark] = a.match(/^(.*?)([*†‡]*)$/);
      return (name === me ? `<span class="me">${esc(name)}</span>` : esc(name)) + esc(mark);
    })
    .join(', ');
}

function linksHTML(links = [], lang) {
  const live = links.filter((l) => l.url);
  if (!live.length) return '';
  const items = live
    .map((l) => `<a href="${esc(href(l.url))}">[${esc(L(l.label, lang))}]</a>`)
    .join('\n            ');
  return `\n          <div class="entry-links">\n            ${items}\n          </div>`;
}

function titleHTML(title, url, cls = 'entry-title') {
  if (!title) return '';
  const inner = url ? `<a href="${esc(href(url))}">${esc(title)}</a>` : esc(title);
  return `<div class="${cls}">${inner}</div>`;
}

function publicationHTML(pub, lang) {
  const parts = [titleHTML(pub.title, pub.url)];
  const authors = authorsHTML(pub.authors);
  if (authors) {
    const an = L(pub.authorsNote, lang);
    parts.push(`<div class="entry-authors">${authors}${an ? ` <span class="authors-note">(${esc(an)})</span>` : ''}</div>`);
  }
  const venue = L(pub.venue, lang);
  if (venue) parts.push(`<div class="entry-venue">${esc(venue)}</div>`);
  const note = L(pub.note, lang);
  if (note) parts.push(`<div class="entry-note">${inline(note)}</div>`);
  return `<li class="entry">
          ${parts.join('\n          ')}${linksHTML(pub.links, lang)}
        </li>`;
}

function projectHTML(item, lang) {
  const parts = [titleHTML(L(item.title, lang), item.url)];
  const meta = L(item.meta, lang);
  if (meta) parts.push(`<div class="entry-meta">${inline(meta)}</div>`);
  const note = L(item.note, lang);
  if (note) parts.push(`<div class="entry-note">${inline(note)}</div>`);
  return `<li class="entry">
          ${parts.join('\n          ')}${linksHTML(item.links, lang)}
        </li>`;
}

function fundingHTML(item, lang) {
  const name = L(item.name, lang);
  const label = item.url ? `<a href="${esc(item.url)}">${esc(name)}</a>` : esc(name);
  const year = item.year ? ` <span class="year">${esc(item.year)}</span>` : '';
  return `<li>${label}${year}</li>`;
}

function contactHTML(lang, ui, otherHref, otherLabel) {
  const items = [];
  if (site.contact.email) {
    items.push(`<li><a href="mailto:${esc(site.contact.email)}">${esc(ui.email)}</a></li>`);
  }
  if (site.contact.scholar) {
    items.push(`<li><a href="${esc(site.contact.scholar)}" rel="me">${esc(ui.scholar)}</a></li>`);
  }
  if (site.contact.github) {
    items.push(`<li><a href="${esc(site.contact.github)}" rel="me">${esc(ui.github)}</a></li>`);
  }
  items.push(`<li><a href="${otherHref}" hreflang="${otherLabel.lang}" lang="${otherLabel.lang}">${esc(otherLabel.text)}</a></li>`);
  return items.join('\n            ');
}

function portraitHTML(lang, prefix) {
  if (!site.site.photo) {
    return `<div class="portrait"><div class="portrait-placeholder" aria-hidden="true"></div></div>`;
  }
  const alt = L(site.site.photoCaption, lang);
  return `<div class="portrait"><img src="${prefix}${esc(site.site.photo)}" alt="${esc(alt)}"></div>`;
}

/* ---------- page -------------------------------------------------- */

function page(lang) {
  const ui = site.ui[lang];
  const id = site.identity[lang];
  const meta = site.meta[lang];
  const isJa = lang === 'ja';
  const prefix = isJa ? '../' : '';            // relative path back to site root
  const otherHref = isJa ? '../' : 'ja/';
  const otherLabel = isJa ? { lang: 'en', text: 'English' } : { lang: 'ja', text: '日本語' };
  const base = site.site.url ? site.site.url.replace(/\/$/, '') : '';
  const canonical = base ? (isJa ? `${base}/ja/` : `${base}/`) : '';

  const visible = (key) => (research[key] || []).filter((p) => !isDraft(p));
  const funding = visible('funding');

  // A subsection disappears when every entry in it is a draft.
  const subsection = (label, items, render) =>
    items.length
      ? `<h3>${esc(label)}</h3>
          <ul class="entries">
            ${items.map((i) => render(i, lang)).join('\n            ')}
          </ul>`
      : '';

  PREFIX = prefix;

  const pageTitle = id.subtitle ? `${id.name} — ${id.subtitle}` : id.name;

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: id.name,
    alternateName: isJa ? site.identity.en.name : site.identity.ja.name,
    description: meta.description,
  };
  if (id.subtitle) jsonld.jobTitle = id.subtitle;
  if (canonical) jsonld.url = canonical;
  const sameAs = [site.contact.scholar, site.contact.github].filter(Boolean);
  if (sameAs.length) jsonld.sameAs = sameAs;

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(pageTitle)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    meta.keywords ? `<meta name="keywords" content="${esc(meta.keywords)}">` : '',
    `<meta name="author" content="${esc(id.name)}">`,
    canonical ? `<link rel="canonical" href="${canonical}">` : '',
    base ? `<link rel="alternate" hreflang="en" href="${base}/">` : '',
    base ? `<link rel="alternate" hreflang="ja" href="${base}/ja/">` : '',
    base ? `<link rel="alternate" hreflang="x-default" href="${base}/">` : '',
    `<meta property="og:type" content="profile">`,
    `<meta property="og:title" content="${esc(pageTitle)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:locale" content="${isJa ? 'ja_JP' : 'en_US'}">`,
    `<meta property="og:locale:alternate" content="${isJa ? 'en_US' : 'ja_JP'}">`,
    canonical ? `<meta property="og:url" content="${canonical}">` : '',
    base && site.site.photo ? `<meta property="og:image" content="${base}/${esc(site.site.photo)}">` : '',
    `<meta name="twitter:card" content="summary">`,
    site.site.noindex ? `<meta name="robots" content="noindex, nofollow">` : '',
    `<link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml">`,
    `<link rel="stylesheet" href="${prefix}style.css">`,
    `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="${lang}">
  <head>
    ${head.join('\n    ')}
  </head>
  <body>
    <a class="skip-link" href="#main">${esc(ui.skipToContent)}</a>
    <div class="wrap">
      <header class="masthead">
        ${portraitHTML(lang, prefix)}
        <div class="masthead-text">
          <h1>${esc(id.name)}</h1>
          ${id.subtitle ? `<p class="subtitle">${esc(id.subtitle)}</p>` : ''}
          <ul class="contact">
            ${contactHTML(lang, ui, otherHref, otherLabel)}
          </ul>
        </div>
      </header>

      <main id="main">
        <div class="intro">
        ${markdown(bios[lang])}
        </div>

        <section aria-labelledby="research">
          <h2 id="research">${esc(ui.research)}</h2>

          ${subsection(ui.publications, visible('publications'), publicationHTML)}

          ${subsection(ui.talks, visible('talks'), projectHTML)}

          ${subsection(ui.writing, visible('writing'), projectHTML)}

          ${subsection(ui.ongoing, visible('ongoing'), projectHTML)}

          ${subsection(ui.projects, visible('projects'), projectHTML)}
        </section>

        <section aria-labelledby="funding">
          <h2 id="funding">${esc(ui.funding)}</h2>
          <ul class="funding">
            ${funding.map((f) => fundingHTML(f, lang)).join('\n            ')}
          </ul>
        </section>
      </main>

      <footer>
        <span>© ${esc(site.site.year)} ${esc(id.name)}</span>
        <span><a href="${otherHref}" lang="${otherLabel.lang}">${esc(otherLabel.text)}</a></span>
      </footer>
    </div>
  </body>
</html>
`;
}

/* ---------- write ------------------------------------------------- */

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'ja'), { recursive: true });

  fs.writeFileSync(path.join(OUT, 'index.html'), page('en'));
  fs.writeFileSync(path.join(OUT, 'ja', 'index.html'), page('ja'));
  fs.copyFileSync(path.join(ROOT, 'assets/style.css'), path.join(OUT, 'style.css'));
  fs.copyFileSync(path.join(ROOT, 'assets/favicon.svg'), path.join(OUT, 'favicon.svg'));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  // Anything in assets/files (slides, posters, PDFs) is published at /files/.
  const filesDir = path.join(ROOT, 'assets', 'files');
  if (fs.existsSync(filesDir)) {
    fs.mkdirSync(path.join(OUT, 'files'), { recursive: true });
    for (const f of fs.readdirSync(filesDir)) {
      if (f.startsWith('.')) continue;
      fs.copyFileSync(path.join(filesDir, f), path.join(OUT, 'files', f));
    }
  }
  fs.writeFileSync(
    path.join(OUT, 'robots.txt'),
    site.site.noindex ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n'
  );
  if (site.site.noindex) {
    warnings.push('noindex is ON (site.site.noindex) — search engines are asked not to index the site. Set it to false when you are ready to be findable.');
  }

  if (site.site.photo) {
    const src = path.join(ROOT, 'assets', site.site.photo);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, site.site.photo));
    else warnings.push(`site.photo is "${site.site.photo}" but assets/${site.site.photo} does not exist.`);
  } else {
    warnings.push('No profile photo set (site.site.photo is empty) — a placeholder circle is shown.');
  }

  if (!site.contact.email) warnings.push('No email set (contact.email) — the Email link is omitted.');
  if (!site.contact.github) warnings.push('No GitHub URL set (contact.github) — the GitHub link is omitted.');
  if (!site.site.url) warnings.push('No site URL set (site.site.url) — canonical, hreflang and og:url tags are omitted.');

  const drafts = []
    .concat(research.publications, research.ongoing, research.projects, research.writing, research.talks)
    .filter(isDraft);
  const todos = []
    .concat(research.publications, research.ongoing, research.projects, research.writing, research.talks, research.funding)
    .filter((e) => e.todo);

  console.log(`built  dist/index.html        (${research.publications.filter((p) => !isDraft(p)).length} publications)`);
  console.log(`built  dist/ja/index.html`);

  if (drafts.length) {
    console.log(`\nunpublished drafts (draft: true — not on the site):`);
    drafts.forEach((d) => console.log(`  · ${d.id}${d.todo ? ` — ${d.todo}` : ''}`));
  }
  if (todos.length) {
    console.log(`\nopen TODOs in content:`);
    todos.forEach((t) => console.log(`  · ${t.id || L(t.name, 'en')} — ${t.todo}`));
  }
  if (warnings.length) {
    console.log(`\nplaceholders to fill in:`);
    warnings.forEach((w) => console.log(`  · ${w}`));
  }
  console.log('\nSee TODO.md for the full pre-publication checklist.');
}

build();

/* ---------- optional preview server ------------------------------- */

if (process.argv.includes('--serve')) {
  const http = require('http');
  const port = Number(process.env.PORT) || 8080;
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

  http
    .createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(OUT, url);
      if (!file.startsWith(OUT)) { res.writeHead(403).end('Forbidden'); return; }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, () => console.log(`\npreview  http://localhost:${port}/   (Japanese: /ja/)`));
}
