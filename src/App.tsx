import { useState, useCallback } from "react";

// ── Icons (inline SVG to avoid import issues) ────────────────
function Icon({ d, size = 20, className = "" }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  copy: "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M16 4h2a2 2 0 0 1 2 2v4M8 4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2Z",
  check: "M20 6 9 17l-5-5",
  chevDown: "m6 9 6 6 6-6",
  chevRight: "m9 18 6-6-6-6",
  ext: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3",
  zap: "M13 2 3 14h9l-1 10 10-12h-9l1-10z",
  db: "M12 2C6.48 2 2 4.02 2 6.5v11C2 19.98 6.48 22 12 22s10-2.02 10-4.5v-11C22 4.02 17.52 2 12 2Z",
  film: "M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5M2 2h20v20H2z",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  refresh: "M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  rocket: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3M22 2l-7.5 7.5",
  terminal: "M4 17l6-6-6-6M12 19h8",
  settings: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z",
  heart: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
  globe: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM2 12h20",
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4",
  clock: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
  play: "M5 3l14 9-14 9V3z",
  git: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  book: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  coffee: "M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3",
  folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  alert: "M12 9v4M12 17h.01M10.29 3.86l-8.71 15.09A2 2 0 0 0 3.34 22h17.32a2 2 0 0 0 1.76-2.95L13.71 3.86a2 2 0 0 0-3.42 0z",
};

// ── Copy Button ──────────────────────────────────────────────
function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all
        bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-300 cursor-pointer">
      {copied
        ? <><Icon d={ICONS.check} size={13} className="text-green-400" /> Copied!</>
        : <><Icon d={ICONS.copy} size={13} /> {label || "Copy"}</>
      }
    </button>
  );
}

// ── Collapsible Code ─────────────────────────────────────────
function CodeBlock({ title, code, lang, open: defaultOpen = false }: {
  title: string; code: string; lang: string; open?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0d1117]">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#161b22] hover:bg-[#1c2129] transition-colors cursor-pointer">
        <div className="flex items-center gap-2">
          <Icon d={ICONS.file} size={16} className="text-purple-400" />
          <span className="text-sm font-medium text-gray-200">{title}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono">{lang}</span>
        </div>
        <div className="flex items-center gap-2">
          <CopyBtn text={code} />
          <Icon d={open ? ICONS.chevDown : ICONS.chevRight} size={16} className="text-gray-400" />
        </div>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-white/5">
          <pre className="p-4 text-[13px] leading-relaxed text-gray-300 whitespace-pre"><code>{code}</code></pre>
        </div>
      )}
    </div>
  );
}

// ── Feature Card ─────────────────────────────────────────────
function FeatureCard({ icon, title, desc, color }: {
  icon: string; title: string; desc: string; color: string;
}) {
  return (
    <div className="group p-6 rounded-2xl bg-[#111127] border border-white/5 hover:border-purple-500/30 transition-all duration-300">
      <div className={`inline-flex p-3 rounded-xl mb-4 ${color}`}>
        <Icon d={icon} size={24} />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

// ── Step Card ────────────────────────────────────────────────
function Step({ num, title, last, children }: { num: number; title: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative pl-14">
      <div className="absolute left-0 top-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500
        flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-purple-500/20">{num}</div>
      {!last && <div className="absolute left-[1.15rem] top-10 bottom-0 w-0.5 bg-gradient-to-b from-purple-500/40 to-transparent" />}
      <div className={last ? "" : "pb-10"}>
        <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

function IC({ children }: { children: React.ReactNode }) {
  return <code className="px-1.5 py-0.5 rounded bg-white/10 text-purple-300 text-xs font-mono">{children}</code>;
}

// ═════════════════════════════════════════════════════════════
//  SOURCE CODE CONSTANTS
// ═════════════════════════════════════════════════════════════

const SERVER_JS = `// Stremio M3U Addon Server v2.0
// Full source: see deploy/server.js in the project

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const M3U_URL       = process.env.M3U_URL || "";
const TMDB_API_KEY  = process.env.TMDB_API_KEY || "";
const PORT          = parseInt(process.env.PORT, 10) || 7000;
const RENDER_URL    = process.env.RENDER_EXTERNAL_URL || "";
const REFRESH_HOURS = parseInt(process.env.REFRESH_HOURS, 10) || 6;
const REFRESH_MS    = REFRESH_HOURS * 3600000;
const KEEP_ALIVE_MS = 10 * 60000;

let allItems = [], catalogMap = {}, groupTitles = [];
let lastRefresh = null;
const tmdbCache = {};

// ── M3U Parser ───────────────────────────────────────
function parseM3U(raw) {
  const lines = raw.split(/\\r?\\n/);
  const items = [];
  let cur = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("#EXTINF:")) {
      cur = parseExtInf(line);
    } else if (line && !line.startsWith("#") && cur) {
      cur.streamUrl = line;
      cur.id = makeId(cur);
      items.push(cur);
      cur = null;
    }
  }
  return items;
}

function parseExtInf(line) {
  const getAttr = (key) => {
    const m = line.match(new RegExp(key + '="([^"]*)"', "i"));
    return m ? m[1].trim() : "";
  };
  const type = getAttr("type") || "movie";
  const tvgLogo = getAttr("tvg-logo");
  const groupLogo = getAttr("group-logo");
  const group = getAttr("group-title");
  const ci = line.lastIndexOf(",");
  const rawName = ci !== -1 ? line.substring(ci + 1).trim() : "";
  return { type, tvgLogo, groupLogo, group, rawName, ...parseDisplayName(rawName) };
}

function parseDisplayName(name) {
  const d = { title: name, year: null, genre: [], duration: null,
    director: null, writers: null, stars: [], imdbRating: null, language: null };
  if (!name) return d;

  // IMDB rating (handles bold unicode + plain)
  const imdbM = name.match(/[I\\u{1D5DC}][M\\u{1D5E0}][D\\u{1D5D7}][B\\u{1D5D5}]\\s*([\\d.]+)/iu);
  if (imdbM) d.imdbRating = parseFloat(imdbM[1]);

  // Year
  const years = [...name.matchAll(/\\b((?:19|20)\\d{2})\\b/g)];
  if (years.length) d.year = parseInt(years[0][1], 10);

  // Title (before first parenthesis)
  const tM = name.match(/^([^(]*?)(?:\\s*\\(|$)/);
  if (tM && tM[1].trim()) d.title = tM[1].trim();

  // Genre from ‧-delimited: ‧ Comedy\\\\Drama\\\\Hindi ‧
  const gM = name.match(/‧\\s*([\\w\\s\\\\\\\\/|]+)\\s*‧/);
  if (gM) {
    d.genre = gM[1].split(/[\\\\\\\\/|]/).map(g => g.trim()).filter(Boolean);
    const langs = ["Hindi","Tamil","Telugu","Malayalam","Kannada","English","Korean","Japanese"];
    const last = d.genre[d.genre.length - 1];
    if (last && langs.includes(last)) d.language = last;
  }

  // Duration, Director, Writers, Stars
  const durM = name.match(/(\\d+h\\s*\\d*m?)/i);
  if (durM) d.duration = durM[1];
  const dirM = name.match(/Directors?\\s+([^|)]+)/i);
  if (dirM) d.director = dirM[1].trim();
  const wriM = name.match(/Writers?\\s+([^|)]+)/i);
  if (wriM) d.writers = wriM[1].trim();
  const staM = name.match(/Stars?\\s+(.+?)(?:\\)|$)/i);
  if (staM) d.stars = staM[1].split("‧").map(s => s.trim()).filter(Boolean);

  return d;
}

function makeId(item) {
  return "m3u_" + (item.title + "__" + (item.year || "0"))
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ── TMDB Fallback ────────────────────────────────────
async function fetchTMDB(title, year) {
  if (!TMDB_API_KEY) return null;
  const ck = title + "|" + (year || "");
  if (ck in tmdbCache) return tmdbCache[ck];
  try {
    const q = encodeURIComponent(title);
    let url = \`https://api.themoviedb.org/3/search/movie?api_key=\${TMDB_API_KEY}&query=\${q}\`;
    if (year) url += \`&year=\${year}\`;
    let { data } = await axios.get(url, { timeout: 8000 });
    if (!data.results?.length && year) {
      const r2 = await axios.get(
        \`https://api.themoviedb.org/3/search/movie?api_key=\${TMDB_API_KEY}&query=\${q}\`,
        { timeout: 8000 });
      data = r2.data;
    }
    if (!data.results?.length) { tmdbCache[ck] = null; return null; }
    const { data: det } = await axios.get(
      \`https://api.themoviedb.org/3/movie/\${data.results[0].id}?api_key=\${TMDB_API_KEY}&append_to_response=credits,external_ids\`,
      { timeout: 8000 });
    const result = {
      poster: det.poster_path ? \`https://image.tmdb.org/t/p/w500\${det.poster_path}\` : null,
      background: det.backdrop_path ? \`https://image.tmdb.org/t/p/w1280\${det.backdrop_path}\` : null,
      description: det.overview, imdbRating: det.vote_average?.toFixed(1),
      year: det.release_date ? new Date(det.release_date).getFullYear() : null,
      genres: det.genres?.map(g => g.name) || [],
      runtime: det.runtime ? Math.floor(det.runtime/60)+"h "+det.runtime%60+"m" : null,
      director: det.credits?.crew?.find(c => c.job==="Director")?.name,
      cast: det.credits?.cast?.slice(0,5).map(c => c.name) || [],
      imdb_id: det.imdb_id || det.external_ids?.imdb_id,
    };
    tmdbCache[ck] = result;
    return result;
  } catch (err) { tmdbCache[ck] = null; return null; }
}

// ── Refresh M3U ──────────────────────────────────────
async function refreshM3U() {
  if (!M3U_URL) return console.warn("[M3U] No M3U_URL set");
  try {
    const { data } = await axios.get(M3U_URL, {
      timeout: 60000, responseType: "text",
      headers: { "User-Agent": "StremioM3UAddon/2.0" }
    });
    const items = parseM3U(typeof data === "string" ? data : String(data));
    const map = {};
    for (const item of items) {
      const g = item.group || "Uncategorized";
      if (!map[g]) map[g] = [];
      map[g].push(item);
    }
    for (const g of Object.keys(map)) {
      map[g].sort((a, b) => {
        if (a.year && b.year && a.year !== b.year) return b.year - a.year;
        if (a.imdbRating && b.imdbRating) return b.imdbRating - a.imdbRating;
        return (a.title||"").localeCompare(b.title||"");
      });
    }
    allItems = items;
    catalogMap = map;
    groupTitles = Object.keys(map).sort();
    lastRefresh = new Date();
    console.log("[M3U]", items.length, "items,", groupTitles.length, "groups");
  } catch (err) { console.error("[M3U] Error:", err.message); }
}

// ── Build Meta ───────────────────────────────────────
async function toMeta(item, full = false) {
  let poster = item.tvgLogo, bg = null, desc = null;
  let genres = item.genre?.length ? [...item.genre] : [];
  let dir = item.director, cast = item.stars?.length ? [...item.stars] : [];
  let rating = item.imdbRating, runtime = item.duration, imdb_id = null, year = item.year;

  if ((!poster || !desc || !genres.length) && TMDB_API_KEY) {
    const t = await fetchTMDB(item.title, item.year);
    if (t) {
      if (!poster) poster = t.poster;
      if (!bg) bg = t.background;
      if (!desc) desc = t.description;
      if (!genres.length && t.genres.length) genres = t.genres;
      if (!dir) dir = t.director;
      if (!cast.length) cast = t.cast;
      if (!rating) rating = parseFloat(t.imdbRating);
      if (!runtime) runtime = t.runtime;
      if (t.imdb_id) imdb_id = t.imdb_id;
      if (!year) year = t.year;
    }
  }
  if (!desc) {
    const p = [];
    if (rating) p.push("⭐ IMDB " + rating);
    if (year) p.push("📅 " + year);
    if (runtime) p.push("⏱ " + runtime);
    if (genres.length) p.push("🎭 " + genres.join(", "));
    if (dir) p.push("🎬 " + dir);
    if (cast.length) p.push("🌟 " + cast.join(", "));
    desc = p.join("\\n") || item.rawName;
  }
  const meta = { id: item.id, type: "movie", name: item.title };
  if (poster) meta.poster = poster;
  if (bg) meta.background = bg; else if (poster) meta.background = poster;
  if (desc) meta.description = desc;
  if (year) meta.year = year;
  if (genres.length) meta.genres = genres;
  if (runtime) meta.runtime = runtime;
  if (rating) meta.imdbRating = rating;
  if (dir) meta.director = [dir];
  if (cast.length) meta.cast = cast;
  if (full) { meta.behaviorHints = { defaultVideoId: item.id }; if (imdb_id) meta.imdb_id = imdb_id; }
  return meta;
}

// ── Manifest ─────────────────────────────────────────
function collectGenres(items) {
  const s = new Set();
  items.forEach(i => { i.genre?.forEach(g => s.add(g)); if(i.language) s.add(i.language); });
  return [...s].sort();
}

function buildManifest() {
  const catalogs = [];
  if (allItems.length) catalogs.push({
    type: "movie", id: "m3u_all", name: "📺 All Movies",
    extra: [
      { name: "search", isRequired: false },
      { name: "genre", isRequired: false, options: collectGenres(allItems) },
      { name: "skip", isRequired: false },
    ],
  });
  for (const g of groupTitles) catalogs.push({
    type: "movie", id: "m3u_" + g.replace(/[^a-zA-Z0-9]/g, "_"), name: g,
    extra: [
      { name: "search", isRequired: false },
      { name: "genre", isRequired: false, options: collectGenres(catalogMap[g]||[]) },
      { name: "skip", isRequired: false },
    ],
  });
  return {
    id: "community.m3u.stremio.addon", version: "2.0.0",
    name: "M3U Stremio Addon",
    description: "Stream movies from M3U with TMDB metadata",
    logo: "https://img.icons8.com/color/512/popcorn-time.png",
    resources: ["catalog","meta","stream"], types: ["movie"],
    catalogs, behaviorHints: { adult: false },
    idPrefixes: ["m3u_"],
  };
}

// ── Express Routes ───────────────────────────────────
const app = express();
app.use(cors());

app.get("/manifest.json", (req, res) => res.json(buildManifest()));

app.get("/catalog/:type/:id/:extra?.json", async (req, res) => {
  const { id } = req.params;
  const extras = {};
  const es = req.params.extra || "";
  if (es) decodeURIComponent(es).split("&").forEach(p => {
    const i = p.indexOf("="); if(i!==-1) extras[p.slice(0,i)]=p.slice(i+1);
  });
  let items = id === "m3u_all" ? [...allItems] :
    [...(catalogMap[groupTitles.find(g =>
      "m3u_"+g.replace(/[^a-zA-Z0-9]/g,"_")===id)]||[])];
  if (extras.search) {
    const q = extras.search.toLowerCase();
    items = items.filter(i =>
      i.title?.toLowerCase().includes(q) ||
      i.rawName?.toLowerCase().includes(q));
  }
  if (extras.genre) items = items.filter(i =>
    i.genre?.includes(extras.genre) || i.language === extras.genre);
  items.sort((a,b) => {
    if(a.year&&b.year&&a.year!==b.year) return b.year-a.year;
    if(a.imdbRating&&b.imdbRating) return b.imdbRating-a.imdbRating;
    return (a.title||"").localeCompare(b.title||"");
  });
  const skip = parseInt(extras.skip)||0;
  const page = items.slice(skip, skip+100);
  const metas = [];
  for(let i=0;i<page.length;i+=5)
    metas.push(...await Promise.all(page.slice(i,i+5).map(it=>toMeta(it))));
  res.json({ metas });
});

app.get("/meta/:type/:id.json", async (req, res) => {
  const item = allItems.find(i => i.id === req.params.id);
  if (!item) return res.json({ meta: null });
  res.json({ meta: await toMeta(item, true) });
});

app.get("/stream/:type/:id.json", (req, res) => {
  const item = allItems.find(i => i.id === req.params.id);
  if (!item?.streamUrl) return res.json({ streams: [] });
  res.json({ streams: [{
    title: "▶️ " + item.title + (item.duration?" ("+item.duration+")":""),
    url: item.streamUrl,
    behaviorHints: { notWebReady: false, bingeGroup: item.group||"default" },
  }]});
});

app.get("/health", (req,res) => res.json({
  status:"ok", items:allItems.length, groups:groupTitles.length,
  lastRefresh:lastRefresh?.toISOString(), tmdb:!!TMDB_API_KEY,
  uptime:Math.floor(process.uptime()), keepAlive:!!RENDER_URL,
}));

// ── Landing page at / ────────────────────────────────
app.get("/", (req, res) => {
  const base = RENDER_URL || req.protocol+"://"+req.get("host");
  const url = base + "/manifest.json";
  res.send(\`<html><body style="background:#0a0a1a;color:#fff;
    font-family:sans-serif;display:flex;align-items:center;
    justify-content:center;min-height:100vh">
    <div style="text-align:center">
    <h1>🎬 M3U Stremio Addon</h1>
    <p>\${allItems.length} movies • \${groupTitles.length} categories</p>
    <br><a href="stremio://\${url.replace(/^https?:\\\\/\\\\//, "")}"
    style="background:#7b5ea7;color:#fff;padding:12px 24px;
    border-radius:8px;text-decoration:none;font-weight:bold">
    Install in Stremio</a>
    <p style="margin-top:16px;color:#666;font-size:13px">\${url}</p>
    </div></body></html>\`);
});

// ── Keep-Alive & Start ───────────────────────────────
function startKeepAlive() {
  if (!RENDER_URL) return;
  console.log("[KEEP-ALIVE] Pinging every 10 min:", RENDER_URL);
  setInterval(async () => {
    try { await axios.get(RENDER_URL+"/health",{timeout:15000}); }
    catch(e) { console.error("[KEEP-ALIVE] Failed:", e.message); }
  }, KEEP_ALIVE_MS);
}

(async () => {
  console.log("🎬 Stremio M3U Addon v2.0");
  console.log("M3U:", M3U_URL ? "✅" : "❌");
  console.log("TMDB:", TMDB_API_KEY ? "✅" : "❌");
  await refreshM3U();
  app.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 Port", PORT);
    setInterval(refreshM3U, REFRESH_MS);
    startKeepAlive();
  });
})();`;

const PKG_JSON = `{
  "name": "stremio-m3u-addon",
  "version": "2.0.0",
  "description": "Stremio addon — M3U with TMDB fallback, sort/filter, keep-alive",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "axios": "^1.7.9",
    "cors": "^2.8.5",
    "express": "^4.21.2"
  },
  "engines": { "node": ">=18.0.0" }
}`;

const RENDER_YAML = `services:
  - type: web
    name: stremio-m3u-addon
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: node server.js
    healthCheckPath: /health
    envVars:
      - key: M3U_URL
        sync: false
      - key: TMDB_API_KEY
        sync: false
      - key: RENDER_EXTERNAL_URL
        sync: false
      - key: PORT
        value: 7000
      - key: REFRESH_HOURS
        value: 6`;

const ENV_EXAMPLE = `# ── REQUIRED ──────────────────────────
# Raw GitHub URL to your M3U playlist file
# ⚠ Must use raw.githubusercontent.com, NOT github.com
M3U_URL=https://raw.githubusercontent.com/user/repo/main/playlist.m3u

# ── OPTIONAL ──────────────────────────
# TMDB API Key (free at themoviedb.org/settings/api)
TMDB_API_KEY=

# Your Render URL — enables keep-alive self-ping
# Set this AFTER first deploy
RENDER_EXTERNAL_URL=https://your-app.onrender.com

PORT=7000
REFRESH_HOURS=6`;

// ═════════════════════════════════════════════════════════════
//  MAIN APP
// ═════════════════════════════════════════════════════════════

export default function App() {
  const [tab, setTab] = useState<"deploy" | "code" | "config">("deploy");

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100">
      {/* ── HERO ─────────────────────────────── */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-blue-900/20" />
        <div className="absolute top-20 left-1/4 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />

        <nav className="relative z-10 max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xl">🎬</div>
            <span className="font-bold text-lg">M3U Stremio Addon</span>
          </div>
          <div className="flex gap-1">
            <a href="#features" className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Features</a>
            <a href="#guide" className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Guide</a>
          </div>
        </nav>

        <div className="relative z-10 max-w-4xl mx-auto px-6 pt-16 pb-24 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm mb-8">
            <Icon d={ICONS.zap} size={14} />
            Render Free Tier Ready with Keep-Alive
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold mb-6 leading-tight">
            <span className="gradient-text">Stremio M3U</span>
            <br />
            <span className="text-white">Addon Server</span>
          </h1>

          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Deploy a full-stack Stremio addon that parses M3U playlists from raw GitHub URLs,
            with TMDB fallback, auto-refresh every 6 hours, and smart keep-alive for Render's free tier.
          </p>

          <div className="flex flex-wrap gap-4 justify-center">
            <a href="#guide" className="px-8 py-4 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold text-lg hover:from-purple-500 hover:to-blue-500 transition-all shadow-lg shadow-purple-500/25 glow-pulse">
              🚀 Deploy Now
            </a>
            <a href="#code-tab" className="px-8 py-4 rounded-xl bg-white/5 border border-white/10 text-white font-semibold text-lg hover:bg-white/10 transition-all" onClick={(e) => { e.preventDefault(); setTab("code"); document.getElementById("guide")?.scrollIntoView({ behavior: "smooth" }); }}>
              📋 View Code
            </a>
          </div>
        </div>
      </header>

      {/* ── ARCHITECTURE ─────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 -mt-8 mb-20">
        <div className="rounded-2xl bg-[#111127] border border-white/5 p-8 grid grid-cols-2 md:grid-cols-5 gap-6 text-center">
          {[
            { icon: "📋", label: "M3U Source", sub: "Raw GitHub URL" },
            { icon: "⚙️", label: "Parser", sub: "Smart Extraction" },
            { icon: "🎬", label: "TMDB", sub: "Fallback Metadata" },
            { icon: "📡", label: "Stremio API", sub: "Catalog/Meta/Stream" },
            { icon: "🔄", label: "Keep-Alive", sub: "Self-Ping 10min" },
          ].map((item, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="text-3xl mb-2">{item.icon}</div>
              <div className="font-semibold text-sm text-white">{item.label}</div>
              <div className="text-xs text-gray-500">{item.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-6 mb-24">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-3">Packed with Features</h2>
          <p className="text-gray-400">Everything for a production-grade Stremio addon</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard icon={ICONS.db} title="Smart M3U Parsing" desc="Extracts type, tvg-logo, group-title, IMDB rating, year, genre, duration, director, writers, and stars from complex M3U entries." color="bg-purple-500/10 text-purple-400" />
          <FeatureCard icon={ICONS.film} title="TMDB Fallback" desc="When M3U entries lack poster, description, or genre data, automatically fetches rich metadata from The Movie Database API." color="bg-blue-500/10 text-blue-400" />
          <FeatureCard icon={ICONS.filter} title="Sort & Filter in Stremio" desc="Each group-title becomes a separate catalog with genre filters. Search across titles, actors, and directors directly in Stremio." color="bg-green-500/10 text-green-400" />
          <FeatureCard icon={ICONS.refresh} title="Auto-Refresh Every 6hrs" desc="M3U source is automatically re-fetched and re-parsed every 6 hours to keep your catalog fresh." color="bg-amber-500/10 text-amber-400" />
          <FeatureCard icon={ICONS.shield} title="Render Keep-Alive" desc="Built-in self-pinging mechanism every 10 minutes prevents Render's free tier from spinning down your server." color="bg-red-500/10 text-red-400" />
          <FeatureCard icon={ICONS.search} title="Smart Catalog Groups" desc="M3U group-titles become separate Stremio catalogs. An 'All Movies' catalog aggregates everything." color="bg-cyan-500/10 text-cyan-400" />
        </div>
      </section>

      {/* ── M3U FORMAT ───────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="rounded-2xl bg-[#111127] border border-white/5 p-8">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
            <Icon d={ICONS.file} size={24} className="text-purple-400" />
            Supported M3U Format
          </h2>
          <p className="text-gray-400 mb-6">The parser handles this exact format:</p>
          <div className="bg-[#0d1117] border border-[#21262d] rounded-lg overflow-x-auto">
            <pre className="p-4 text-[13px] leading-relaxed text-gray-300">{`#EXTM3U

#EXTINF:-1 type="movie" group-logo="" tvg-logo="https://image-url.jpg" group-title="VT 🎬 | Tamil Movies",Gandhi Talks (𝗜𝗠𝗗𝗕 6.6 2026 ‧ Comedy\\Drama\\Hindi ‧ 2h 10m Director Kishor Pandurang Belekar | Writers Kishor Pandurang Belekar | Stars Vijay Sethupathi ‧ Aditi Rao Hydari ‧ Mahesh Manjrekar)
https://tentkotta.short.gy/AgADWB5903.mkv`}</pre>
          </div>
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <div className="bg-[#0d1117] rounded-lg p-4 border border-white/5">
              <h4 className="text-sm font-semibold text-purple-300 mb-2">📌 Parsed Fields</h4>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>• <IC>type</IC> — movie / series</li>
                <li>• <IC>tvg-logo</IC> — poster URL</li>
                <li>• <IC>group-title</IC> — catalog category</li>
                <li>• Title, Year, IMDB Rating from display name</li>
                <li>• Genre, Duration, Director, Writers, Stars</li>
              </ul>
            </div>
            <div className="bg-[#0d1117] rounded-lg p-4 border border-white/5">
              <h4 className="text-sm font-semibold text-blue-300 mb-2">🔄 TMDB Fallback Logic</h4>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>• Empty <IC>tvg-logo</IC> → TMDB poster</li>
                <li>• No description → TMDB overview</li>
                <li>• Missing genres → TMDB genres</li>
                <li>• Empty director/cast → TMDB credits</li>
                <li>• All TMDB results cached in memory</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── TABS ─────────────────────────────── */}
      <section id="guide" className="max-w-6xl mx-auto px-6 mb-24">
        <div className="flex gap-1 mb-8 border-b border-white/10">
          {([
            { key: "deploy" as const, label: "🚀 Deploy Guide" },
            { key: "code" as const, label: "📋 Source Code" },
            { key: "config" as const, label: "⚙️ Configuration" },
          ]).map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-all cursor-pointer ${
                tab === key ? "border-purple-500 text-purple-300" : "border-transparent text-gray-500 hover:text-gray-300"
              }`}>{label}</button>
          ))}
        </div>

        {/* ── DEPLOY TAB ──────────────────────── */}
        {tab === "deploy" && (
          <div className="space-y-2">
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <Icon d={ICONS.alert} size={20} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-red-300 mb-1">⚠️ Critical: Repo Structure</h4>
                  <p className="text-xs text-red-200/80">
                    Your GitHub repo must have <IC>server.js</IC> and <IC>package.json</IC> at the <strong className="text-white">ROOT level</strong> of the repository.
                    NOT inside a subfolder. Render looks for files at the root.
                  </p>
                </div>
              </div>
            </div>

            <Step num={1} title="Create a NEW GitHub Repository">
              <p className="text-gray-400 text-sm">
                Create a new repo (e.g., <IC>stremio-m3u-addon</IC>). Add these files <strong className="text-white">at the root</strong>:
              </p>
              <div className="bg-[#0d1117] border border-[#21262d] rounded-lg overflow-x-auto">
                <pre className="p-3 text-sm text-gray-400">{`your-repo/          ← repository root
├── server.js       ← main addon server (MUST be at root)
├── package.json    ← dependencies (MUST be at root)
├── render.yaml     ← (optional) Render blueprint
└── .env.example    ← environment reference`}</pre>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-xs text-amber-300">
                  ⚠️ Do NOT put files in a subfolder like <IC>server/server.js</IC> — Render expects them at root.
                  Copy the code from the <strong className="text-white">Source Code</strong> tab.
                </p>
              </div>
            </Step>

            <Step num={2} title="Sign Up on Render (Free)">
              <p className="text-gray-400 text-sm">
                Go to{" "}
                <a href="https://render.com" target="_blank" className="text-purple-400 hover:underline">render.com</a>
                {" "}and sign up with your GitHub account.
              </p>
            </Step>

            <Step num={3} title="Create Web Service">
              <p className="text-gray-400 text-sm">Click <strong className="text-white">New → Web Service</strong>, connect your repo, then configure:</p>
              <div className="bg-[#0d1117] rounded-lg border border-white/5 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-[#161b22]">
                      <th className="px-4 py-2.5 text-left text-gray-400 font-medium text-xs">Setting</th>
                      <th className="px-4 py-2.5 text-left text-gray-400 font-medium text-xs">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Name", "stremio-m3u-addon"],
                      ["Region", "Oregon (US West) or closest"],
                      ["Branch", "main"],
                      ["Root Directory", "(leave empty / blank)"],
                      ["Runtime", "Node"],
                      ["Build Command", "npm install"],
                      ["Start Command", "node server.js"],
                      ["Instance Type", "Free"],
                    ].map(([k, v]) => (
                      <tr key={k} className="border-b border-white/5">
                        <td className="px-4 py-2.5 text-gray-400">{k}</td>
                        <td className="px-4 py-2.5"><IC>{v}</IC></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Step>

            <Step num={4} title="Set Environment Variables">
              <p className="text-gray-400 text-sm">In Render dashboard → <strong className="text-white">Environment</strong> tab:</p>
              <div className="bg-[#0d1117] rounded-lg border border-white/5 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-[#161b22]">
                      <th className="px-4 py-2 text-left text-gray-400 font-medium text-xs">Variable</th>
                      <th className="px-4 py-2 text-left text-gray-400 font-medium text-xs">Value</th>
                      <th className="px-4 py-2 text-left text-gray-400 font-medium text-xs">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["M3U_URL", "https://raw.githubusercontent.com/user/repo/main/playlist.m3u", "✅ Required"],
                      ["TMDB_API_KEY", "your_tmdb_api_key_here", "📌 Optional"],
                      ["RENDER_EXTERNAL_URL", "https://stremio-m3u-addon.onrender.com", "🔄 After deploy"],
                      ["REFRESH_HOURS", "6", "📌 Optional"],
                    ].map(([k, v, s]) => (
                      <tr key={k} className="border-b border-white/5">
                        <td className="px-4 py-2.5 font-mono text-purple-300 text-xs">{k}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs break-all">{v}</td>
                        <td className="px-4 py-2.5 text-xs text-amber-300 whitespace-nowrap">{s}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                <p className="text-xs text-blue-300">
                  💡 <strong>RENDER_EXTERNAL_URL:</strong> Deploy first, copy your <IC>.onrender.com</IC> URL,
                  then add it as env var and redeploy. This enables the keep-alive pinger.
                </p>
              </div>
            </Step>

            <Step num={5} title="Deploy & Verify">
              <p className="text-gray-400 text-sm">Click <strong className="text-white">Create Web Service</strong>. Once deployed, verify:</p>
              <div className="bg-[#0d1117] border border-[#21262d] rounded-lg overflow-x-auto">
                <pre className="p-3 text-sm text-green-400">{`# Check health
curl https://your-app.onrender.com/health

# Check manifest
curl https://your-app.onrender.com/manifest.json

# Check catalog
curl https://your-app.onrender.com/catalog/movie/m3u_all.json`}</pre>
              </div>
            </Step>

            <Step num={6} title="Install in Stremio" last>
              <p className="text-gray-400 text-sm">Two ways to install:</p>
              <div className="space-y-3">
                <div className="flex items-start gap-3 bg-[#0d1117] rounded-lg p-4 border border-white/5">
                  <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-300 text-xs font-bold shrink-0">A</div>
                  <div>
                    <p className="text-sm text-gray-300">Open Stremio → Addons → paste your manifest URL in the search bar:</p>
                    <p className="text-xs text-purple-300 font-mono mt-1">https://your-app.onrender.com/manifest.json</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 bg-[#0d1117] rounded-lg p-4 border border-white/5">
                  <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-300 text-xs font-bold shrink-0">B</div>
                  <div>
                    <p className="text-sm text-gray-300">Visit your addon's landing page at <IC>https://your-app.onrender.com/</IC> and click <strong className="text-white">Install in Stremio</strong></p>
                  </div>
                </div>
              </div>
            </Step>
          </div>
        )}

        {/* ── CODE TAB ────────────────────────── */}
        {tab === "code" && (
          <div id="code-tab" className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <Icon d={ICONS.folder} size={20} className="text-green-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-green-300 mb-1">📁 File Placement</h4>
                  <p className="text-xs text-green-200/80">
                    All files go at the <strong className="text-white">ROOT</strong> of your GitHub repository.
                    <IC>server.js</IC> and <IC>package.json</IC> are the only required files.
                  </p>
                </div>
              </div>
            </div>

            <CodeBlock title="server.js" code={SERVER_JS} lang="JavaScript" />
            <CodeBlock title="package.json" code={PKG_JSON} lang="JSON" open />
            <CodeBlock title="render.yaml" code={RENDER_YAML} lang="YAML" />
            <CodeBlock title=".env.example" code={ENV_EXAMPLE} lang="ENV" open />
          </div>
        )}

        {/* ── CONFIG TAB ──────────────────────── */}
        {tab === "config" && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-[#111127] border border-white/5 p-8">
              <h3 className="text-xl font-bold text-white mb-6">Environment Variables</h3>

              {[
                {
                  icon: ICONS.link, color: "text-green-400", name: "M3U_URL", badge: "Required", badgeColor: "bg-amber-500/20 text-amber-300",
                  desc: "The raw GitHub URL pointing to your M3U playlist file.",
                  example: "M3U_URL=https://raw.githubusercontent.com/username/repo/main/playlist.m3u",
                  warn: "Must be a raw URL (raw.githubusercontent.com), not the HTML GitHub page URL.",
                },
                {
                  icon: ICONS.key, color: "text-blue-400", name: "TMDB_API_KEY", badge: "Optional", badgeColor: "bg-blue-500/20 text-blue-300",
                  desc: "When entries are missing poster/description/genres, the server queries TMDB to fill gaps.",
                  link: { text: "Get free API key →", url: "https://www.themoviedb.org/settings/api" },
                },
                {
                  icon: ICONS.globe, color: "text-red-400", name: "RENDER_EXTERNAL_URL", badge: "Keep-Alive", badgeColor: "bg-red-500/20 text-red-300",
                  desc: "Your Render app's URL. The server self-pings /health every 10 min to prevent spindown.",
                  example: "RENDER_EXTERNAL_URL=https://stremio-m3u-addon.onrender.com",
                },
                {
                  icon: ICONS.clock, color: "text-amber-400", name: "REFRESH_HOURS", badge: "Default: 6", badgeColor: "bg-gray-500/20 text-gray-300",
                  desc: "How often (in hours) to re-fetch and re-parse the M3U source.",
                },
              ].map((v) => (
                <div key={v.name} className="bg-[#0d1117] rounded-xl p-5 border border-white/5 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon d={v.icon} size={16} className={v.color} />
                    <h4 className="font-semibold text-white font-mono text-sm">{v.name}</h4>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${v.badgeColor}`}>{v.badge}</span>
                  </div>
                  <p className="text-sm text-gray-400 mb-2">{v.desc}</p>
                  {v.example && (
                    <div className="bg-[#161b22] rounded-lg overflow-x-auto border border-white/5">
                      <pre className="p-3 text-xs text-gray-400">{v.example}</pre>
                    </div>
                  )}
                  {v.warn && (
                    <div className="mt-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <p className="text-xs text-amber-300">⚠️ {v.warn}</p>
                    </div>
                  )}
                  {v.link && (
                    <a href={v.link.url} target="_blank" className="inline-flex items-center gap-1 text-sm text-blue-400 hover:underline mt-2">
                      {v.link.text} <Icon d={ICONS.ext} size={12} />
                    </a>
                  )}
                </div>
              ))}
            </div>

            {/* API Endpoints */}
            <div className="rounded-2xl bg-[#111127] border border-white/5 p-8">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Icon d={ICONS.play} size={22} className="text-green-400" />
                Stremio API Endpoints
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-[#0d1117] rounded-xl p-5 border border-white/5">
                  <h4 className="text-sm font-semibold text-purple-300 mb-3">📡 Routes</h4>
                  <div className="space-y-2 text-xs font-mono">
                    {[
                      ["GET", "/manifest.json"],
                      ["GET", "/catalog/:type/:id/:extra?.json"],
                      ["GET", "/meta/:type/:id.json"],
                      ["GET", "/stream/:type/:id.json"],
                      ["GET", "/health"],
                      ["GET", "/  (landing page)"],
                    ].map(([m, p]) => (
                      <div key={p} className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">{m}</span>
                        <span className="text-gray-400">{p}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-[#0d1117] rounded-xl p-5 border border-white/5">
                  <h4 className="text-sm font-semibold text-blue-300 mb-3">🎯 Catalog Features</h4>
                  <ul className="text-xs text-gray-400 space-y-2">
                    <li className="flex items-start gap-2">
                      <Icon d={ICONS.star} size={12} className="text-amber-400 shrink-0 mt-0.5" />
                      Sorted by year (newest), then IMDB rating
                    </li>
                    <li className="flex items-start gap-2">
                      <Icon d={ICONS.filter} size={12} className="text-green-400 shrink-0 mt-0.5" />
                      Genre filter from M3U metadata
                    </li>
                    <li className="flex items-start gap-2">
                      <Icon d={ICONS.search} size={12} className="text-blue-400 shrink-0 mt-0.5" />
                      Search by title, actor, director
                    </li>
                    <li className="flex items-start gap-2">
                      <Icon d={ICONS.db} size={12} className="text-purple-400 shrink-0 mt-0.5" />
                      100 items per page with skip pagination
                    </li>
                    <li className="flex items-start gap-2">
                      <Icon d={ICONS.film} size={12} className="text-red-400 shrink-0 mt-0.5" />
                      Each group-title = separate catalog
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── QUICK START LOCAL DEV ─────────────── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="rounded-2xl bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/10 p-8">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
            <Icon d={ICONS.terminal} size={24} className="text-purple-400" />
            Quick Start (Local Development)
          </h2>
          <p className="text-gray-400 mb-6">Test locally before deploying to Render:</p>

          {[
            { label: "1. Create project", cmd: `mkdir stremio-m3u-addon && cd stremio-m3u-addon\nnpm init -y\nnpm install express cors axios` },
            { label: "2. Create server.js", cmd: `# Copy server.js from the Source Code tab above\n# Paste into: stremio-m3u-addon/server.js` },
            { label: "3. Set environment & run", cmd: `export M3U_URL="https://raw.githubusercontent.com/user/repo/main/playlist.m3u"\nexport TMDB_API_KEY="your_tmdb_key"  # optional\nnode server.js` },
            { label: "4. Test endpoints", cmd: `curl http://localhost:7000/health\ncurl http://localhost:7000/manifest.json\ncurl http://localhost:7000/catalog/movie/m3u_all.json` },
          ].map((step, i) => (
            <div key={i} className="bg-[#0d1117] rounded-lg border border-white/5 overflow-hidden mb-3">
              <div className="flex items-center justify-between px-4 py-2 bg-[#161b22]">
                <span className="text-xs text-gray-400">{step.label}</span>
                <CopyBtn text={step.cmd} />
              </div>
              <pre className="p-3 text-xs text-gray-300 overflow-x-auto">{step.cmd}</pre>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <h2 className="text-3xl font-bold text-white mb-8 text-center">How It Works</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { s: "1", e: "📥", t: "Fetch M3U", d: "Server fetches your raw GitHub M3U file on startup and every 6 hours" },
            { s: "2", e: "🔍", t: "Parse & Extract", d: "Smart parser extracts all metadata: title, year, rating, cast, genres" },
            { s: "3", e: "🎬", t: "TMDB Enrich", d: "Missing posters or details? TMDB API fills the gaps with rich metadata" },
            { s: "4", e: "📡", t: "Serve to Stremio", d: "Catalogs, metadata, and streams served via Stremio addon protocol" },
          ].map((item) => (
            <div key={item.s} className="text-center p-6 rounded-2xl bg-[#111127] border border-white/5">
              <div className="text-4xl mb-3">{item.e}</div>
              <div className="inline-flex w-8 h-8 rounded-full bg-purple-500/20 items-center justify-center text-purple-300 text-sm font-bold mb-3">{item.s}</div>
              <h4 className="font-semibold text-white mb-2">{item.t}</h4>
              <p className="text-xs text-gray-400 leading-relaxed">{item.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── KEEP ALIVE ───────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="rounded-2xl bg-[#111127] border border-white/5 p-8">
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            <Icon d={ICONS.heart} size={24} className="text-red-400" />
            Render Free Tier Keep-Alive
          </h2>
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div>
              <h4 className="text-sm font-semibold text-red-300 mb-3">⚠️ The Problem</h4>
              <p className="text-sm text-gray-400 leading-relaxed">
                Render's free tier spins down after 15 minutes of inactivity, causing ~30s cold start delay.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-green-300 mb-3">✅ The Solution</h4>
              <p className="text-sm text-gray-400 leading-relaxed">
                Server self-pings <IC>/health</IC> every 10 minutes using <IC>RENDER_EXTERNAL_URL</IC>. Keeps it warm 24/7.
              </p>
            </div>
          </div>
          <div className="bg-[#0d1117] border border-[#21262d] rounded-lg overflow-x-auto">
            <pre className="p-4 text-xs text-gray-400">{`// Built-in keep-alive — no external cron needed!
setInterval(async () => {
  await axios.get(RENDER_EXTERNAL_URL + "/health");
  // Pings every 10 minutes → server never sleeps
}, 10 * 60 * 1000);`}</pre>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <p className="text-xs text-blue-300">
              💡 <strong>Backup option:</strong> Set up a free cron at{" "}
              <a href="https://cron-job.org" target="_blank" className="underline">cron-job.org</a>
              {" "}to ping <IC>/health</IC> every 5 minutes.
            </p>
          </div>
        </div>
      </section>

      {/* ── TROUBLESHOOTING ──────────────────── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="rounded-2xl bg-[#111127] border border-red-500/10 p-8">
          <h2 className="text-2xl font-bold text-white mb-6">🔧 Troubleshooting</h2>
          <div className="space-y-4">
            {[
              {
                q: 'Error: Cannot find module server.js',
                a: 'Your server.js is NOT at the repo root. Move it out of any subfolder. In Render, Root Directory must be empty/blank.',
              },
              {
                q: 'M3U shows 0 items',
                a: 'Check M3U_URL is a raw.githubusercontent.com URL. Test with: curl $M3U_URL — it should return the M3U text content.',
              },
              {
                q: 'No posters showing',
                a: 'Your M3U entries have empty tvg-logo. Set TMDB_API_KEY env var for automatic poster fallback.',
              },
              {
                q: 'Server keeps spinning down',
                a: 'Set RENDER_EXTERNAL_URL to your .onrender.com URL. Check Render logs for "[KEEP-ALIVE] Ping OK" messages.',
              },
              {
                q: 'Build fails on Render',
                a: 'Ensure Build Command is "npm install" and Start Command is "node server.js". Runtime must be "Node".',
              },
            ].map((item, i) => (
              <div key={i} className="bg-[#0d1117] rounded-lg p-4 border border-white/5">
                <h4 className="text-sm font-semibold text-red-300 mb-1">❌ {item.q}</h4>
                <p className="text-xs text-gray-400">✅ {item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────── */}
      <footer className="border-t border-white/5 py-12">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-sm">🎬</div>
            <span className="font-bold">M3U Stremio Addon</span>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Express.js • TMDB API • Render Free Tier • Keep-Alive
          </p>
          <div className="flex items-center justify-center gap-1 text-sm text-gray-600">
            Made with <Icon d={ICONS.coffee} size={14} className="text-amber-500" /> for the Stremio community
          </div>
        </div>
      </footer>
    </div>
  );
}
