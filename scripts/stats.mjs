import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const user = process.argv[2] || process.env.GH_USER;
if (!user) throw new Error('usage: node stats.mjs <username>');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date().toISOString().slice(0, 10);

async function page(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'profile-stats' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

async function calendar() {
  const html = await page(`https://github.com/users/${user}/contributions`);
  const counts = new Map();
  for (const m of html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const n = m[2].match(/^(\d+)/);
    counts.set(m[1], n ? Number(n[1]) : 0);
  }
  const days = [];
  for (const m of html.matchAll(/<td[^>]*data-date="([^"]+)"[^>]*id="([^"]+)"[^>]*data-level="(\d)"/g)) {
    if (m[1] <= today) days.push({ date: m[1], level: Number(m[3]), count: counts.get(m[2]) ?? 0 });
  }
  if (!days.length) throw new Error('empty contribution calendar');
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

async function repos() {
  let url = `https://github.com/${user}?tab=repositories`;
  const langs = new Map();
  let total = 0;
  for (let i = 0; i < 10 && url; i++) {
    const html = await page(url);
    for (const li of html.match(/<li[^>]*itemprop="owns"[\s\S]*?<\/li>/g) || []) {
      total++;
      const l = li.match(/itemprop="programmingLanguage">([^<]+)/);
      if (l) langs.set(l[1], (langs.get(l[1]) || 0) + 1);
    }
    const next = html.match(/rel="next"[^>]*href="([^"]+)"/) || html.match(/href="([^"]+)"[^>]*rel="next"/);
    url = next ? new URL(next[1].replace(/&amp;/g, '&'), 'https://github.com').href : null;
  }
  return { total, langs };
}

function streaks(days) {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let i = days.length - 1;
  if (days[i].date === today && days[i].count === 0) i--;
  let current = 0;
  while (i >= 0 && days[i].count > 0) { current++; i--; }
  return { current, longest };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render({ days, repoTotal, langs }) {
  const W = 800, H = 312, PAD = 30;
  const heat = ['#14292b', '#14584f', '#1a8c78', '#2dc9a0', '#8cffe0'];
  const palette = ['#2dd4a8', '#5fd3e8', '#9be8b8', '#3b9c92', '#c4f5e6', '#7aa8a4'];
  const { current, longest } = streaks(days);
  const yearTotal = days.reduce((s, d) => s + d.count, 0);

  const blocks = [
    [yearTotal, 'contributions, last year'],
    [`${current} d`, 'current streak'],
    [`${longest} d`, 'longest streak'],
    [repoTotal, 'public repositories'],
  ];
  const stats = blocks.map(([v, label], i) => {
    const x = PAD + i * 185;
    return `<text x="${x}" y="84" font-size="30" font-weight="700" fill="#eafff8">${esc(v)}</text>` +
      `<text x="${x}" y="105" font-size="12" fill="#6f9a96">${esc(label)}</text>`;
  }).join('');

  const ranked = [...langs.entries()].sort((a, b) => b[1] - a[1]);
  const sum = ranked.reduce((s, [, n]) => s + n, 0);
  let bar = '';
  let legend = '';
  if (sum) {
    const barW = W - PAD * 2;
    let x = PAD;
    let lx = PAD;
    ranked.forEach(([name, n], i) => {
      const w = (n / sum) * barW;
      const color = palette[i % palette.length];
      bar += `<rect x="${x.toFixed(1)}" y="128" width="${w.toFixed(1)}" height="8" fill="${color}"/>`;
      x += w;
      const label = `${name} ${Math.round((n / sum) * 100)}%`;
      legend += `<circle cx="${lx + 4}" cy="157" r="4" fill="${color}"/>` +
        `<text x="${lx + 14}" y="161" font-size="12" fill="#a9cbc6">${esc(label)}</text>`;
      lx += 14 + label.length * 6.6 + 18;
    });
    bar = `<clipPath id="bar"><rect x="${PAD}" y="128" width="${barW}" height="8" rx="4"/></clipPath><g clip-path="url(#bar)">${bar}</g>`;
  }

  const offset = new Date(days[0].date + 'T00:00:00Z').getUTCDay();
  const cells = days.map((d, i) => {
    const col = Math.floor((i + offset) / 7);
    const row = (i + offset) % 7;
    return `<rect x="${PAD + col * 14}" y="${186 + row * 14}" width="11" height="11" rx="2.5" fill="${heat[d.level]}"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub snapshot for ${esc(user)}">
<title>GitHub snapshot for ${esc(user)}</title>
<g font-family="'Segoe UI','Helvetica Neue',Arial,sans-serif">
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" fill="#0b1517" stroke="#1e3d3b"/>
<text x="${PAD}" y="40" font-size="15" font-weight="600" fill="#2dd4a8">GitHub snapshot</text>
<text x="${W - PAD}" y="40" font-size="12" text-anchor="end" fill="#6f9a96">@${esc(user)}</text>
${stats}
${bar}
${legend}
${cells}
<text x="${W - PAD}" y="302" font-size="11" text-anchor="end" fill="#4d7773">updated ${today}</text>
</g>
</svg>
`;
}

const [days, r] = await Promise.all([calendar(), repos()]);
await mkdir(path.join(root, 'assets'), { recursive: true });
await writeFile(path.join(root, 'assets', 'stats.svg'), render({ days, repoTotal: r.total, langs: r.langs }));
console.log(`stats.svg written for ${user}`);
