import { useState, useCallback } from "react";
import {
  Copy, Check, ChevronDown, ChevronRight, ExternalLink,
  Play, RefreshCw, Shield, Zap, Database, Clock, Search,
  Filter, Star, Film, GitBranch, Terminal, Globe,
  BookOpen, Rocket, Settings, Key, Link2, FileText,
  Heart, Coffee
} from "lucide-react";

// ── Copy Button ──────────────────────────────────────────────
function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all
        bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-300"
    >
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      {label || (copied ? "Copied!" : "Copy")}
    </button>
  );
}

// ── Collapsible Code Block ────────────────────────────────────
function CodeBlock({ title, code, language, defaultOpen = false }: {
  title: string; code: string; language: string; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0d1117]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#161b22] hover:bg-[#1c2129] transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-purple-400" />
          <span className="text-sm font-medium text-gray-200">{title}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono">{language}</span>
        </div>
        <div className="flex items-center gap-2">
          <CopyBtn text={code} />
          {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        </div>
      </button>
      {open && (
        <div className="code-block border-0 rounded-none">
          <pre className="p-4 text-[13px] leading-relaxed text-gray-300 overflow-x-auto">
            <code>{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Feature Card ─────────────────────────────────────────────
function FeatureCard({ icon: Icon, title, desc, color }: {
  icon: any; title: string; desc: string; color: string;
}) {
  return (
    <div className="group p-6 rounded-2xl bg-[#111127] border border-white/5 hover:border-purple-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/5">
      <div className={`inline-flex p-3 rounded-xl mb-4 ${color}`}>
        <Icon size={24} />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

// ── Step Card ────────────────────────────────────────────────
function StepCard({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-14">
      <div className="absolute left-0 top-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-purple-500/20">
        {num}
      </div>
      {num < 6 && <div className="step-connector" />}
      <div className="pb-10">
        <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

// ── Inline Code ──────────────────────────────────────────────
function IC({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-white/10 text-purple-300 text-xs font-mono">{children}</code>
  );
}

// ── SERVER CODE ──────────────────────────────────────────────
const SERVER_CODE = `// ============================================================
//  Stremio M3U Addon Server — Full-Stack Render Deployment
//  Features: M3U parsing, TMDB fallback, 6hr auto-refresh,
//            Render free-tier keep-alive, sort & filter catalogs
// ============================================================

const express = require("express");
const cors = require("cors");
const axios = require("axios");

// ── ENV ──────────────────────────────────────────────────────
const M3U_URL = process.env.M3U_URL || "";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const PORT = parseInt(process.env.PORT, 10) || 7000;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || "";
const REFRESH_HOURS = parseInt(process.env.REFRESH_HOURS, 10) || 6;
const REFRESH_MS = REFRESH_HOURS * 60 * 60 * 1000;
const KEEP_ALIVE_MS = 10 * 60 * 1000; // 10 minutes

// ── CACHE ────────────────────────────────────────────────────
let allItems = [];
let catalogMap = {};
let groupTitles = [];
let lastRefresh = null;
let tmdbCache = {};

// ── M3U PARSER ───────────────────────────────────────────────
function parseM3U(content) {
  const lines = content.split("\\n");
  const items = [];
  let cur = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("#EXTINF:")) {
      cur = parseExtInf(line);
    } else if (line && !line.startsWith("#") && cur) {
      cur.url = line;
      cur.id = generateId(cur);
      items.push(cur);
      cur = null;
    }
  }
  return items;
}

function parseExtInf(line) {
  const attr = (key) => {
    const r = new RegExp(key + '="([^"]*)"', "i");
    const m = line.match(r);
    return m ? m[1] : "";
  };
  const type = attr("type") || "movie";
  const logo = attr("tvg-logo");
  const groupLogo = attr("group-logo");
  const group = attr("group-title");
  const commaIdx = line.lastIndexOf(",");
  const rawName = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : "";
  const details = parseMovieDetails(rawName);
  return { type, logo, groupLogo, group, rawName, ...details };
}

function parseMovieDetails(name) {
  const d = {
    title: name, year: null, genre: [], duration: null,
    director: null, writers: null, stars: [], imdbRating: null, language: null,
  };
  const imdb = name.match(/[𝗜I][𝗠M][𝗗D][𝗕B]\\s*([\\d.]+)/i);
  if (imdb) d.imdbRating = parseFloat(imdb[1]);
  const yrAll = [...name.matchAll(/\\b((?:19|20)\\d{2})\\b/g)];
  if (yrAll.length) d.year = parseInt(yrAll[0][1], 10);
  const titleM = name.match(/^([^(𝗜]*)/);
  if (titleM) {
    let t = titleM[1].trim();
    if (t.endsWith("(")) t = t.slice(0, -1).trim();
    if (t) d.title = t;
  }
  const genreM = name.match(/‧\\s*([A-Za-z\\\\\\/|]+(?:\\s*[A-Za-z\\\\\\/|]+)*)\\s*‧/);
  if (genreM) {
    d.genre = genreM[1].split(/[\\\\\\/|]/).map(g => g.trim()).filter(Boolean);
  }
  const dur = name.match(/(\\d+h\\s*\\d*m?)/i);
  if (dur) d.duration = dur[1];
  const dir = name.match(/Directors?\\s+([^|)]+)/i);
  if (dir) d.director = dir[1].trim();
  const wri = name.match(/Writers?\\s+([^|)]+)/i);
  if (wri) d.writers = wri[1].trim();
  const sta = name.match(/Stars?\\s+(.+?)(?:\\)|$)/i);
  if (sta) d.stars = sta[1].split("‧").map(s => s.trim()).filter(Boolean);
  return d;
}

function generateId(item) {
  const base = (item.title + "__" + (item.year || "0"))
    .toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return "m3u_" + base;
}

// ── TMDB FALLBACK ────────────────────────────────────────────
async function fetchTMDB(title, year) {
  if (!TMDB_API_KEY) return null;
  const key = title + "|" + (year || "");
  if (tmdbCache[key] !== undefined) return tmdbCache[key];
  try {
    const q = encodeURIComponent(title);
    let searchUrl = \`https://api.themoviedb.org/3/search/movie?api_key=\${TMDB_API_KEY}&query=\${q}\`;
    if (year) searchUrl += \`&year=\${year}\`;
    const { data } = await axios.get(searchUrl, { timeout: 8000 });
    if (!data.results?.length) { tmdbCache[key] = null; return null; }
    const movie = data.results[0];
    const detUrl = \`https://api.themoviedb.org/3/movie/\${movie.id}?api_key=\${TMDB_API_KEY}&append_to_response=credits,external_ids\`;
    const { data: det } = await axios.get(detUrl, { timeout: 8000 });
    const result = {
      poster: det.poster_path ? \`https://image.tmdb.org/t/p/w500\${det.poster_path}\` : null,
      background: det.backdrop_path ? \`https://image.tmdb.org/t/p/w1280\${det.backdrop_path}\` : null,
      description: det.overview, imdbRating: det.vote_average?.toFixed(1),
      year: det.release_date ? new Date(det.release_date).getFullYear() : null,
      genres: det.genres?.map(g => g.name) || [],
      runtime: det.runtime ? Math.floor(det.runtime/60)+"h "+det.runtime%60+"m" : null,
      director: det.credits?.crew?.find(c => c.job==="Director")?.name,
      cast: det.credits?.cast?.slice(0,5).map(c => c.name) || [],
      imdb_id: det.imdb_id || det.external_ids?.imdb_id, tmdb_id: det.id,
    };
    tmdbCache[key] = result;
    return result;
  } catch (err) {
    console.error("[TMDB] Error:", err.message);
    tmdbCache[key] = null;
    return null;
  }
}

// ── REFRESH M3U ──────────────────────────────────────────────
async function refreshM3U() {
  if (!M3U_URL) return console.warn("[M3U] No M3U_URL configured.");
  console.log("[M3U] Refreshing from:", M3U_URL);
  try {
    const { data } = await axios.get(M3U_URL, {
      timeout: 30000, responseType: "text",
      headers: { "User-Agent": "StremioAddon/1.0" },
    });
    const items = parseM3U(data);
    const map = {};
    for (const item of items) {
      const g = item.group || "Uncategorized";
      if (!map[g]) map[g] = [];
      map[g].push(item);
    }
    allItems = items;
    catalogMap = map;
    groupTitles = Object.keys(map).sort();
    lastRefresh = new Date();
    console.log("[M3U] Parsed", items.length, "items,", groupTitles.length, "groups");
  } catch (err) {
    console.error("[M3U] Refresh error:", err.message);
  }
}

// ── BUILD STREMIO META ───────────────────────────────────────
async function buildMeta(item, full = false) {
  let poster = item.logo, background = null, description = null;
  let genres = item.genre?.length ? item.genre : [];
  let director = item.director, cast = item.stars || [];
  let imdbRating = item.imdbRating, runtime = item.duration;
  let imdb_id = null, year = item.year;

  if ((!poster || !description || !genres.length) && TMDB_API_KEY) {
    const tmdb = await fetchTMDB(item.title, item.year);
    if (tmdb) {
      if (!poster) poster = tmdb.poster;
      if (!background) background = tmdb.background;
      if (!description) description = tmdb.description;
      if (!genres.length && tmdb.genres.length) genres = tmdb.genres;
      if (!director) director = tmdb.director;
      if (!cast.length) cast = tmdb.cast;
      if (!imdbRating) imdbRating = parseFloat(tmdb.imdbRating);
      if (!runtime) runtime = tmdb.runtime;
      if (tmdb.imdb_id) imdb_id = tmdb.imdb_id;
      if (!year) year = tmdb.year;
    }
  }

  if (!description) {
    const parts = [];
    if (imdbRating) parts.push("⭐ IMDB " + imdbRating);
    if (year) parts.push("📅 " + year);
    if (runtime) parts.push("⏱ " + runtime);
    if (director) parts.push("🎬 Director: " + director);
    if (cast.length) parts.push("🌟 Stars: " + cast.join(", "));
    description = parts.join("\\n") || item.rawName;
  }

  const meta = {
    id: item.id, type: item.type === "series" ? "series" : "movie",
    name: item.title, poster, background: background || poster,
    description, year, genres: genres.length ? genres : undefined,
    runtime, imdbRating, director: director ? [director] : undefined,
    cast: cast.length ? cast : undefined,
  };
  if (full) {
    meta.behaviorHints = { defaultVideoId: item.id };
    if (imdb_id) meta.imdb_id = imdb_id;
  }
  return Object.fromEntries(Object.entries(meta).filter(([,v]) => v != null));
}

// ── MANIFEST ─────────────────────────────────────────────────
function buildManifest() {
  const catalogs = groupTitles.map(g => ({
    type: "movie", id: "m3u_" + g.replace(/[^a-zA-Z0-9]/g, "_"),
    name: g, extra: [
      { name: "search", isRequired: false },
      { name: "genre", isRequired: false, options: getGenresForGroup(g) },
      { name: "skip", isRequired: false },
    ],
  }));
  if (groupTitles.length) {
    catalogs.unshift({
      type: "movie", id: "m3u_all", name: "📺 All Movies",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: getAllGenres() },
        { name: "skip", isRequired: false },
      ],
    });
  }
  return {
    id: "community.m3u.stremio.addon", version: "1.0.0",
    name: "M3U Stremio Addon",
    description: "Stream movies from M3U playlists with TMDB metadata",
    logo: "https://img.icons8.com/color/512/popcorn-time.png",
    resources: ["catalog", "meta", "stream"], types: ["movie"],
    catalogs, behaviorHints: { adult: false },
    idPrefixes: ["m3u_"],
  };
}
function getGenresForGroup(group) {
  const s = new Set();
  (catalogMap[group]||[]).forEach(i => { i.genre?.forEach(g=>s.add(g)); if(i.language)s.add(i.language); });
  return [...s].sort();
}
function getAllGenres() {
  const s = new Set();
  allItems.forEach(i => { i.genre?.forEach(g=>s.add(g)); if(i.language)s.add(i.language); });
  return [...s].sort();
}

// ── EXPRESS ──────────────────────────────────────────────────
const app = express();
app.use(cors());

app.get("/manifest.json", (req, res) => res.json(buildManifest()));

app.get("/catalog/:type/:id/:extra?.json", async (req, res) => {
  const { id } = req.params;
  const extras = {};
  const extraStr = req.params.extra || "";
  if (extraStr) decodeURIComponent(extraStr).split("&").forEach(p => {
    const i = p.indexOf("="); if(i!==-1) extras[p.slice(0,i)]=p.slice(i+1);
  });
  let items = id === "m3u_all" ? [...allItems] :
    [...(catalogMap[groupTitles.find(g => "m3u_"+g.replace(/[^a-zA-Z0-9]/g,"_")===id)] || [])];
  if (extras.search) {
    const q = extras.search.toLowerCase();
    items = items.filter(i =>
      i.title.toLowerCase().includes(q) || i.rawName.toLowerCase().includes(q)
    );
  }
  if (extras.genre) items = items.filter(i =>
    i.genre?.includes(extras.genre) || i.language === extras.genre
  );
  items.sort((a,b) => {
    if(a.year&&b.year&&a.year!==b.year) return b.year-a.year;
    if(a.imdbRating&&b.imdbRating) return b.imdbRating-a.imdbRating;
    return a.title.localeCompare(b.title);
  });
  const skip = parseInt(extras.skip,10)||0;
  const paged = items.slice(skip, skip+100);
  const metas = [];
  for(let i=0;i<paged.length;i+=10) {
    metas.push(...await Promise.all(paged.slice(i,i+10).map(it=>buildMeta(it))));
  }
  res.json({ metas });
});

app.get("/meta/:type/:id.json", async (req, res) => {
  const item = allItems.find(i => i.id === req.params.id);
  if (!item) return res.json({ meta: null });
  res.json({ meta: await buildMeta(item, true) });
});

app.get("/stream/:type/:id.json", (req, res) => {
  const item = allItems.find(i => i.id === req.params.id);
  if (!item?.url) return res.json({ streams: [] });
  res.json({ streams: [{
    title: "▶️ " + item.title + (item.duration ? " ("+item.duration+")" : ""),
    url: item.url,
    behaviorHints: { notWebReady: false, bingeGroup: item.group || "default" },
  }]});
});

app.get("/health", (req,res) => res.json({
  status: "ok", items: allItems.length, groups: groupTitles.length,
  lastRefresh: lastRefresh?.toISOString(), tmdb: !!TMDB_API_KEY,
  uptime: process.uptime(),
}));

function getBaseUrl(req) {
  if (RENDER_EXTERNAL_URL) return RENDER_EXTERNAL_URL;
  return (req.headers["x-forwarded-proto"]||req.protocol)+"://"+req.get("host");
}

// Landing page at root
app.get("/", (req, res) => {
  const url = getBaseUrl(req) + "/manifest.json";
  const stremio = "stremio://" + url.replace(/^https?:\\/\\//, "");
  res.send(\`<html><body style="background:#0a0a1a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center"><h1>🎬 M3U Stremio Addon</h1><p>\${allItems.length} movies in \${groupTitles.length} categories</p><br><a href="\${stremio}" style="background:#7b5ea7;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Install in Stremio</a><p style="margin-top:16px;color:#666;font-size:13px">\${url}</p></div></body></html>\`);
});

// ── KEEP-ALIVE ───────────────────────────────────────────────
function startKeepAlive() {
  if (!RENDER_EXTERNAL_URL) return;
  setInterval(async () => {
    try { await axios.get(RENDER_EXTERNAL_URL+"/health",{timeout:10000}); }
    catch(e) { console.error("[KEEP-ALIVE] Failed:", e.message); }
  }, KEEP_ALIVE_MS);
}

// ── START ────────────────────────────────────────────────────
(async () => {
  await refreshM3U();
  app.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
    setInterval(refreshM3U, REFRESH_MS);
    startKeepAlive();
  });
})();`;

const PACKAGE_JSON_CODE = `{
  "name": "stremio-m3u-addon",
  "version": "1.0.0",
  "description": "Stremio addon - M3U playlists with TMDB fallback",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "axios": "^1.7.0",
    "cors": "^2.8.5",
    "express": "^4.18.2"
  },
  "engines": { "node": ">=18.0.0" }
}`;

const RENDER_YAML_CODE = `services:
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
        generateValue: true
      - key: PORT
        value: 7000
      - key: REFRESH_HOURS
        value: 6`;

const ENV_CODE = `# Required — Raw GitHub URL to your M3U playlist
M3U_URL=https://raw.githubusercontent.com/user/repo/main/playlist.m3u

# Optional — TMDB API Key for fallback metadata & posters
# Get free at: https://www.themoviedb.org/settings/api
TMDB_API_KEY=

# Auto-set on Render — used for keep-alive pinger
RENDER_EXTERNAL_URL=

PORT=7000
REFRESH_HOURS=6`;

const DOCKERFILE_CODE = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 7000
CMD ["node", "server.js"]`;

// ── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<"deploy" | "code" | "m3u">("deploy");

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100">
      {/* ── HERO ───────────────────────────────────────── */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-blue-900/20" />
        <div className="absolute top-20 left-1/4 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />

        <nav className="relative z-10 max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xl">
              🎬
            </div>
            <span className="font-bold text-lg">M3U Stremio Addon</span>
          </div>
          <div className="flex gap-2">
            <a href="#features" className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Features</a>
            <a href="#deploy" className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Deploy</a>
            <a href="#code" className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Code</a>
          </div>
        </nav>

        <div className="relative z-10 max-w-4xl mx-auto px-6 pt-16 pb-24 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm mb-8">
            <Zap size={14} />
            <span>Render Free Tier Ready with Keep-Alive</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold mb-6 leading-tight">
            <span className="gradient-text">Stremio M3U</span>
            <br />
            <span className="text-white">Addon Server</span>
          </h1>

          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Deploy a full-stack Stremio addon that parses M3U playlists from raw GitHub URLs,
            with TMDB fallback for rich metadata, auto-refresh every 6 hours, and smart keep-alive
            for Render's free tier.
          </p>

          <div className="flex flex-wrap gap-4 justify-center">
            <a
              href="#deploy"
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold text-lg
                hover:from-purple-500 hover:to-blue-500 transition-all shadow-lg shadow-purple-500/25 glow-pulse"
            >
              <Rocket size={20} className="inline mr-2 -mt-0.5" />
              Deploy Now
            </a>
            <a
              href="#code"
              className="px-8 py-4 rounded-xl bg-white/5 border border-white/10 text-white font-semibold text-lg
                hover:bg-white/10 transition-all"
            >
              <BookOpen size={20} className="inline mr-2 -mt-0.5" />
              View Code
            </a>
          </div>
        </div>
      </header>

      {/* ── ARCHITECTURE BANNER ────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 -mt-8 mb-20">
        <div className="rounded-2xl bg-[#111127] border border-white/5 p-8 grid grid-cols-2 md:grid-cols-5 gap-6 text-center">
          {[
            { icon: "📋", label: "M3U Input", sub: "Raw GitHub URL" },
            { icon: "⚙️", label: "Parser", sub: "Smart Extraction" },
            { icon: "🎬", label: "TMDB", sub: "Fallback Metadata" },
            { icon: "📡", label: "Stremio API", sub: "Catalog/Meta/Stream" },
            { icon: "🔄", label: "Keep Alive", sub: "Auto Ping 10min" },
          ].map((item, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="text-3xl mb-2">{item.icon}</div>
              <div className="font-semibold text-sm text-white">{item.label}</div>
              <div className="text-xs text-gray-500">{item.sub}</div>
              {i < 4 && (
                <div className="hidden md:block absolute translate-x-[4.5rem]">
                  <ChevronRight size={16} className="text-purple-500/40" />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-6 mb-24">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-3">Packed with Features</h2>
          <p className="text-gray-400">Everything you need for a production-grade Stremio addon</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard
            icon={Database}
            title="Smart M3U Parsing"
            desc="Extracts type, tvg-logo, group-title, IMDB rating, year, genre, duration, director, writers, and stars from complex M3U entries."
            color="bg-purple-500/10 text-purple-400"
          />
          <FeatureCard
            icon={Film}
            title="TMDB Fallback"
            desc="When M3U entries lack poster, description, or genre data, automatically fetches rich metadata from The Movie Database API."
            color="bg-blue-500/10 text-blue-400"
          />
          <FeatureCard
            icon={Filter}
            title="Sort & Filter in Stremio"
            desc="Each group-title becomes a separate catalog with genre filters. Search across titles, actors, and directors directly in Stremio."
            color="bg-green-500/10 text-green-400"
          />
          <FeatureCard
            icon={RefreshCw}
            title="Auto-Refresh Every 6hrs"
            desc="M3U source is automatically re-fetched and re-parsed every 6 hours to keep your catalog fresh with the latest content."
            color="bg-amber-500/10 text-amber-400"
          />
          <FeatureCard
            icon={Shield}
            title="Render Keep-Alive"
            desc="Built-in self-pinging mechanism every 10 minutes prevents Render's free tier from spinning down your server."
            color="bg-red-500/10 text-red-400"
          />
          <FeatureCard
            icon={Search}
            title="Smart Catalog Groups"
            desc="M3U group-titles become separate Stremio catalogs. An 'All Movies' catalog aggregates everything with sorting by year and rating."
            color="bg-cyan-500/10 text-cyan-400"
          />
        </div>
      </section>

      {/* ── M3U FORMAT REFERENCE ───────────────────────── */}
      <section id="m3u-ref" className="max-w-6xl mx-auto px-6 mb-24">
        <div className="rounded-2xl bg-[#111127] border border-white/5 p-8">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
            <FileText size={24} className="text-purple-400" />
            Supported M3U Format
          </h2>
          <p className="text-gray-400 mb-6">The parser handles this exact format from your raw GitHub M3U file:</p>
          <div className="code-block">
            <pre className="p-4 text-[13px] leading-relaxed text-gray-300 overflow-x-auto">{`#EXTM3U

#EXTINF:-1 type="movie" group-logo="" tvg-logo="https://image-url.jpg" group-title="VT 🎬 | Tamil Movies",Gandhi Talks (𝗜𝗠𝗗𝗕 6.6 2026 ‧ Comedy\\Drama\\Hindi ‧ 2h 10m Director Kishor Pandurang Belekar | Writers Kishor Pandurang Belekar | Stars Vijay Sethupathi ‧ Aditi Rao Hydari ‧ Mahesh Manjrekar)
https://tentkotta.short.gy/AgADWB5903.mkv

#EXTINF:-1 type="movie" tvg-logo="" group-title="VT 🎬 | Hindi Movies",Pushpa 2 (𝗜𝗠𝗗𝗕 6.2 2024 ‧ Action\\Drama ‧ 3h 20m Director Sukumar | Stars Allu Arjun ‧ Rashmika Mandanna)
https://example.com/pushpa2.mkv`}</pre>
          </div>
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <div className="bg-[#0d1117] rounded-lg p-4 border border-white/5">
              <h4 className="text-sm font-semibold text-purple-300 mb-2">📌 Parsed Fields</h4>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>• <IC>type</IC> — movie / series</li>
                <li>• <IC>tvg-logo</IC> — poster URL</li>
                <li>• <IC>group-title</IC> — catalog category</li>
                <li>• <IC>group-logo</IC> — category icon</li>
                <li>• Title, Year, IMDB Rating from name</li>
                <li>• Genre, Duration, Director, Writers, Stars</li>
              </ul>
            </div>
            <div className="bg-[#0d1117] rounded-lg p-4 border border-white/5">
              <h4 className="text-sm font-semibold text-blue-300 mb-2">🔄 Fallback Logic</h4>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>• If <IC>tvg-logo</IC> is empty → TMDB poster</li>
                <li>• If no description → TMDB overview</li>
                <li>• If genres missing → TMDB genres</li>
                <li>• If director/cast empty → TMDB credits</li>
                <li>• TMDB results are cached in memory</li>
                <li>• Search by title + year for accuracy</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── TABS: DEPLOY / CODE ────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="flex gap-2 mb-8 border-b border-white/10 pb-0">
          {[
            { key: "deploy" as const, icon: Rocket, label: "Deploy Guide" },
            { key: "code" as const, icon: Terminal, label: "Source Code" },
            { key: "m3u" as const, icon: Settings, label: "Configuration" },
          ].map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all -mb-[1px] ${
                activeTab === key
                  ? "border-purple-500 text-purple-300"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {/* ── DEPLOY TAB ──────────────────────────────── */}
        {activeTab === "deploy" && (
          <div id="deploy" className="space-y-2">
            <StepCard num={1} title="Create a GitHub Repository">
              <p className="text-gray-400 text-sm">
                Create a new repo and add two files: <IC>server.js</IC> and <IC>package.json</IC>.
                Copy them from the <strong className="text-white">Source Code</strong> tab.
              </p>
              <div className="code-block">
                <pre className="p-3 text-sm text-gray-400">{`your-repo/
├── server.js        # Main addon server
├── package.json     # Dependencies
├── render.yaml      # (Optional) Render blueprint
└── .env.example     # Environment reference`}</pre>
              </div>
            </StepCard>

            <StepCard num={2} title="Sign Up on Render">
              <p className="text-gray-400 text-sm">
                Go to{" "}
                <a href="https://render.com" target="_blank" className="text-purple-400 hover:underline inline-flex items-center gap-1">
                  render.com <ExternalLink size={12} />
                </a>{" "}
                and sign up with your GitHub account (free).
              </p>
            </StepCard>

            <StepCard num={3} title="Create a New Web Service">
              <p className="text-gray-400 text-sm">Click <strong className="text-white">New → Web Service</strong>, connect your GitHub repo, then configure:</p>
              <div className="bg-[#0d1117] rounded-lg border border-white/5 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["Name", "stremio-m3u-addon"],
                      ["Runtime", "Node"],
                      ["Build Command", "npm install"],
                      ["Start Command", "node server.js"],
                      ["Plan", "Free"],
                    ].map(([k, v]) => (
                      <tr key={k} className="border-b border-white/5">
                        <td className="px-4 py-2.5 text-gray-400 font-medium">{k}</td>
                        <td className="px-4 py-2.5">
                          <IC>{v}</IC>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </StepCard>

            <StepCard num={4} title="Set Environment Variables">
              <p className="text-gray-400 text-sm">
                In the Render dashboard, go to <strong className="text-white">Environment → Add Environment Variable</strong>:
              </p>
              <div className="bg-[#0d1117] rounded-lg border border-white/5 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["M3U_URL", "Your raw GitHub M3U URL", "✅ Required"],
                      ["TMDB_API_KEY", "Your TMDB API key", "Optional"],
                      ["RENDER_EXTERNAL_URL", "Your Render URL (e.g., https://stremio-m3u-addon.onrender.com)", "✅ For keep-alive"],
                      ["REFRESH_HOURS", "6 (default)", "Optional"],
                    ].map(([k, v, req]) => (
                      <tr key={k} className="border-b border-white/5">
                        <td className="px-4 py-2.5 font-mono text-purple-300 text-xs">{k}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{v}</td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className={req.includes("Required") || req.includes("keep") ? "text-amber-400" : "text-gray-500"}>{req}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </StepCard>

            <StepCard num={5} title="Deploy & Get Your Manifest URL">
              <p className="text-gray-400 text-sm">
                Click <strong className="text-white">Deploy</strong>. Once live, your manifest URL will be:
              </p>
              <div className="code-block">
                <pre className="p-3 text-sm text-green-400">{`https://your-app-name.onrender.com/manifest.json`}</pre>
              </div>
            </StepCard>

            <StepCard num={6} title="Install in Stremio">
              <p className="text-gray-400 text-sm">Open Stremio, go to the <strong className="text-white">Addons</strong> page, and either:</p>
              <div className="space-y-3">
                <div className="flex items-start gap-3 bg-[#0d1117] rounded-lg p-4 border border-white/5">
                  <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-300 text-xs font-bold shrink-0 mt-0.5">A</div>
                  <div>
                    <p className="text-sm text-gray-300">Paste your manifest URL in the search box at the top of the Addons page</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 bg-[#0d1117] rounded-lg p-4 border border-white/5">
                  <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-300 text-xs font-bold shrink-0 mt-0.5">B</div>
                  <div>
                    <p className="text-sm text-gray-300">
                      Visit your addon's landing page and click the <strong className="text-white">Install in Stremio</strong> button
                    </p>
                  </div>
                </div>
              </div>
            </StepCard>
          </div>
        )}

        {/* ── CODE TAB ────────────────────────────────── */}
        {activeTab === "code" && (
          <div id="code" className="space-y-4">
            <div className="bg-[#111127] rounded-xl border border-white/5 p-4 mb-6 flex items-start gap-3">
              <GitBranch size={20} className="text-purple-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-gray-300">
                  Create a new GitHub repository with these files. The <IC>server.js</IC> and <IC>package.json</IC> are
                  the only required files for deployment.
                </p>
              </div>
            </div>

            <CodeBlock title="server.js" code={SERVER_CODE} language="JavaScript" defaultOpen={false} />
            <CodeBlock title="package.json" code={PACKAGE_JSON_CODE} language="JSON" defaultOpen={true} />
            <CodeBlock title="render.yaml" code={RENDER_YAML_CODE} language="YAML" defaultOpen={false} />
            <CodeBlock title=".env.example" code={ENV_CODE} language="ENV" defaultOpen={true} />
            <CodeBlock title="Dockerfile" code={DOCKERFILE_CODE} language="Docker" defaultOpen={false} />
          </div>
        )}

        {/* ── CONFIG TAB ──────────────────────────────── */}
        {activeTab === "m3u" && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-[#111127] border border-white/5 p-8">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Settings size={22} className="text-purple-400" />
                Environment Variables Reference
              </h3>

              <div className="space-y-6">
                {/* M3U_URL */}
                <div className="bg-[#0d1117] rounded-xl p-5 border border-white/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Link2 size={16} className="text-green-400" />
                    <h4 className="font-semibold text-white">M3U_URL</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Required</span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">
                    The raw GitHub URL pointing to your M3U playlist file. This is the source of all your content.
                  </p>
                  <div className="code-block">
                    <pre className="p-3 text-xs text-gray-400">{`# Example
M3U_URL=https://raw.githubusercontent.com/username/repo/main/playlist.m3u`}</pre>
                  </div>
                  <div className="mt-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <p className="text-xs text-amber-300">
                      ⚠️ Make sure the URL returns raw text content, not the GitHub HTML page.
                      Use <IC>raw.githubusercontent.com</IC> URLs.
                    </p>
                  </div>
                </div>

                {/* TMDB_API_KEY */}
                <div className="bg-[#0d1117] rounded-xl p-5 border border-white/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Key size={16} className="text-blue-400" />
                    <h4 className="font-semibold text-white">TMDB_API_KEY</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">Optional</span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">
                    When M3U entries are missing poster images, descriptions, or genre information,
                    the server will query TMDB to fill in the gaps. Get a free API key at:
                  </p>
                  <a
                    href="https://www.themoviedb.org/settings/api"
                    target="_blank"
                    className="inline-flex items-center gap-1 text-sm text-blue-400 hover:underline"
                  >
                    themoviedb.org/settings/api <ExternalLink size={12} />
                  </a>
                </div>

                {/* RENDER_EXTERNAL_URL */}
                <div className="bg-[#0d1117] rounded-xl p-5 border border-white/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe size={16} className="text-red-400" />
                    <h4 className="font-semibold text-white">RENDER_EXTERNAL_URL</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">Keep-Alive</span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">
                    Set this to your Render app's external URL. The server will self-ping every 10 minutes
                    to prevent Render's free tier from spinning down.
                  </p>
                  <div className="code-block">
                    <pre className="p-3 text-xs text-gray-400">{`RENDER_EXTERNAL_URL=https://stremio-m3u-addon.onrender.com`}</pre>
                  </div>
                </div>

                {/* REFRESH_HOURS */}
                <div className="bg-[#0d1117] rounded-xl p-5 border border-white/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock size={16} className="text-amber-400" />
                    <h4 className="font-semibold text-white">REFRESH_HOURS</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-300">Default: 6</span>
                  </div>
                  <p className="text-sm text-gray-400">
                    How often (in hours) to re-fetch and re-parse the M3U source. Set to a lower value
                    if your playlist updates frequently.
                  </p>
                </div>
              </div>
            </div>

            {/* Stremio Integration Details */}
            <div className="rounded-2xl bg-[#111127] border border-white/5 p-8">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Play size={22} className="text-green-400" />
                Stremio Integration Details
              </h3>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-[#0d1117] rounded-xl p-5 border border-white/5">
                  <h4 className="text-sm font-semibold text-purple-300 mb-3">📡 API Endpoints</h4>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">GET</span>
                      <span className="text-gray-400">/manifest.json</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">GET</span>
                      <span className="text-gray-400">/catalog/:type/:id/:extra?.json</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">GET</span>
                      <span className="text-gray-400">/meta/:type/:id.json</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">GET</span>
                      <span className="text-gray-400">/stream/:type/:id.json</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">GET</span>
                      <span className="text-gray-400">/health</span>
                    </div>
                  </div>
                </div>

                <div className="bg-[#0d1117] rounded-xl p-5 border border-white/5">
                  <h4 className="text-sm font-semibold text-blue-300 mb-3">🎯 Catalog Features</h4>
                  <ul className="text-xs text-gray-400 space-y-2">
                    <li className="flex items-start gap-2">
                      <Star size={12} className="text-amber-400 shrink-0 mt-0.5" />
                      Sorted by year (newest first), then IMDB rating
                    </li>
                    <li className="flex items-start gap-2">
                      <Filter size={12} className="text-green-400 shrink-0 mt-0.5" />
                      Genre filter extracted from M3U metadata
                    </li>
                    <li className="flex items-start gap-2">
                      <Search size={12} className="text-blue-400 shrink-0 mt-0.5" />
                      Search by title, actor name, or director
                    </li>
                    <li className="flex items-start gap-2">
                      <Database size={12} className="text-purple-400 shrink-0 mt-0.5" />
                      Pagination with skip parameter (100 per page)
                    </li>
                    <li className="flex items-start gap-2">
                      <Film size={12} className="text-red-400 shrink-0 mt-0.5" />
                      Each group-title = separate Stremio catalog
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── QUICK START CLI ────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="rounded-2xl bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/10 p-8">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
            <Terminal size={24} className="text-purple-400" />
            Quick Start (Local Development)
          </h2>
          <p className="text-gray-400 mb-6">Run the addon locally before deploying:</p>

          <div className="space-y-3">
            {[
              { label: "Clone & Install", cmd: "git clone https://github.com/your-user/stremio-m3u-addon.git\ncd stremio-m3u-addon\nnpm install" },
              { label: "Set Environment", cmd: 'export M3U_URL="https://raw.githubusercontent.com/user/repo/main/playlist.m3u"\nexport TMDB_API_KEY="your_tmdb_key_here"  # optional' },
              { label: "Start Server", cmd: "npm start" },
              { label: "Test It", cmd: "# Open in browser:\n# http://localhost:7000/manifest.json\n# http://localhost:7000/health\n# http://localhost:7000/catalog/movie/m3u_all.json" },
            ].map((step, i) => (
              <div key={i} className="bg-[#0d1117] rounded-lg border border-white/5 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-[#161b22]">
                  <span className="text-xs text-gray-400">{step.label}</span>
                  <CopyBtn text={step.cmd} />
                </div>
                <pre className="p-3 text-xs text-gray-300 overflow-x-auto">{step.cmd}</pre>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-3">How It Works</h2>
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          {[
            {
              step: "1",
              emoji: "📥",
              title: "Fetch M3U",
              desc: "Server fetches your raw GitHub M3U file on startup and every 6 hours",
            },
            {
              step: "2",
              emoji: "🔍",
              title: "Parse & Extract",
              desc: "Smart parser extracts all metadata from #EXTINF lines: title, year, rating, cast, etc.",
            },
            {
              step: "3",
              emoji: "🎬",
              title: "TMDB Enrich",
              desc: "Missing posters or details? TMDB API fills the gaps with rich movie metadata",
            },
            {
              step: "4",
              emoji: "📡",
              title: "Serve to Stremio",
              desc: "Catalogs, metadata, and streams served via Stremio addon protocol with sort & filter",
            },
          ].map((item) => (
            <div key={item.step} className="text-center p-6 rounded-2xl bg-[#111127] border border-white/5">
              <div className="text-4xl mb-3">{item.emoji}</div>
              <div className="inline-flex w-8 h-8 rounded-full bg-purple-500/20 items-center justify-center text-purple-300 text-sm font-bold mb-3">
                {item.step}
              </div>
              <h4 className="font-semibold text-white mb-2">{item.title}</h4>
              <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── KEEP ALIVE EXPLAINED ───────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="rounded-2xl bg-[#111127] border border-white/5 p-8">
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            <Heart size={24} className="text-red-400" />
            Render Free Tier Keep-Alive Strategy
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-semibold text-red-300 mb-3">⚠️ The Problem</h4>
              <p className="text-sm text-gray-400 leading-relaxed">
                Render's free tier spins down your service after 15 minutes of inactivity.
                This causes a ~30 second cold start delay when someone tries to use your addon.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-green-300 mb-3">✅ The Solution</h4>
              <p className="text-sm text-gray-400 leading-relaxed">
                The server self-pings its own <IC>/health</IC> endpoint every 10 minutes using the
                <IC>RENDER_EXTERNAL_URL</IC> environment variable. This keeps the service warm 24/7.
              </p>
            </div>
          </div>

          <div className="mt-6 code-block">
            <pre className="p-4 text-xs text-gray-400">{`// Built-in keep-alive — no external cron service needed!
setInterval(async () => {
  await axios.get(RENDER_EXTERNAL_URL + "/health");
  // Pings every 10 minutes → server never sleeps
}, 10 * 60 * 1000);`}</pre>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <p className="text-xs text-blue-300">
              💡 <strong>Pro tip:</strong> As a backup, you can also set up a free cron job at{" "}
              <a href="https://cron-job.org" target="_blank" className="underline">cron-job.org</a>{" "}
              to ping your <IC>/health</IC> endpoint every 5 minutes.
            </p>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-12">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-sm">
              🎬
            </div>
            <span className="font-bold">M3U Stremio Addon</span>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Built with Express.js • TMDB API • Deployed on Render Free Tier
          </p>
          <div className="flex items-center justify-center gap-1 text-sm text-gray-600">
            Made with <Coffee size={14} className="text-amber-500" /> for the Stremio community
          </div>
        </div>
      </footer>
    </div>
  );
}
