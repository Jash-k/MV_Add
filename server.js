// ============================================================
//  Stremio M3U Addon Server v3.0 — Self-Contained
//  Config is encoded in the URL path (base64 JSON).
//  /configure serves embedded HTML — NO external static files.
// ============================================================

const express = require("express");
const cors    = require("cors");
const axios   = require("axios");

const PORT          = parseInt(process.env.PORT, 10) || 7000;
const RENDER_URL    = process.env.RENDER_EXTERNAL_URL || "";
const DEFAULT_TMDB  = process.env.TMDB_API_KEY || "";
const REFRESH_HOURS = parseInt(process.env.REFRESH_HOURS, 10) || 6;
const REFRESH_MS    = REFRESH_HOURS * 3600000;
const KEEP_ALIVE_MS = 10 * 60000;

const sourceCache = {};
const tmdbCache   = {};

// ═══════════════════════════════════════════════════════════
//  CONFIG HELPERS
// ═══════════════════════════════════════════════════════════

function encodeConfig(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function decodeConfig(str) {
  try {
    return JSON.parse(Buffer.from(str, "base64url").toString("utf-8"));
  } catch {
    try { return JSON.parse(Buffer.from(str, "base64").toString("utf-8")); }
    catch { return null; }
  }
}

// ═══════════════════════════════════════════════════════════
//  M3U PARSER
// ═══════════════════════════════════════════════════════════

function parseM3U(raw) {
  const lines = raw.split(/\r?\n/);
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
  const tvgLogo = getAttr("tvg-logo");
  const group = getAttr("group-title");
  const ci = line.lastIndexOf(",");
  const rawName = ci !== -1 ? line.substring(ci + 1).trim() : "";
  return { type: getAttr("type") || "movie", tvgLogo, group, rawName, ...parseDisplayName(rawName) };
}

function parseDisplayName(name) {
  const d = { title: name, year: null, genre: [], duration: null,
    director: null, writers: null, stars: [], imdbRating: null, language: null };
  if (!name) return d;

  const imdbM = name.match(/[I\u{1D5DC}][M\u{1D5E0}][D\u{1D5D7}][B\u{1D5D5}]\s*([\d.]+)/iu);
  if (imdbM) d.imdbRating = parseFloat(imdbM[1]);

  const years = [...name.matchAll(/\b((?:19|20)\d{2})\b/g)];
  if (years.length) d.year = parseInt(years[0][1], 10);

  const tM = name.match(/^([^(]*?)(?:\s*\(|$)/);
  if (tM && tM[1].trim()) d.title = tM[1].trim();

  const gM = name.match(/‧\s*([\w\s\\/|]+(?:\s*[\w\s\\/|]+)*)\s*‧/);
  if (gM) {
    d.genre = gM[1].split(/[\\/|]/).map(g => g.trim()).filter(Boolean);
    const langs = ["Hindi","Tamil","Telugu","Malayalam","Kannada","Bengali","English","Korean","Japanese","Marathi","Punjabi","Gujarati","Urdu","Chinese","Spanish","French","German","Italian","Portuguese","Arabic","Turkish","Thai","Vietnamese","Indonesian","Malay","Filipino"];
    const last = d.genre[d.genre.length - 1];
    if (last && langs.some(l => l.toLowerCase() === last.toLowerCase())) d.language = last;
  }

  const durM = name.match(/(\d+h\s*\d*m?)/i);
  if (durM) d.duration = durM[1];

  const dirM = name.match(/Directors?\s+([^|)]+)/i);
  if (dirM) d.director = dirM[1].trim().replace(/\s+/g, " ");

  const wriM = name.match(/Writers?\s+([^|)]+)/i);
  if (wriM) d.writers = wriM[1].trim().replace(/\s+/g, " ");

  const staM = name.match(/Stars?\s+(.+?)(?:\)|$)/i);
  if (staM) d.stars = staM[1].split("‧").map(s => s.trim()).filter(Boolean);

  return d;
}

function makeId(item) {
  const slug = `${item.title}__${item.year || "0"}`
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `m3u_${slug}`;
}

// ═══════════════════════════════════════════════════════════
//  TMDB FALLBACK
// ═══════════════════════════════════════════════════════════

async function fetchTMDB(title, year, tmdbKey) {
  if (!tmdbKey) return null;
  const ck = `${title}|${year || ""}`;
  if (ck in tmdbCache) return tmdbCache[ck];
  try {
    const q = encodeURIComponent(title);
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${q}`;
    if (year) url += `&year=${year}`;
    let { data } = await axios.get(url, { timeout: 8000 });
    if ((!data.results || !data.results.length) && year) {
      const r2 = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${q}`, { timeout: 8000 });
      data = r2.data;
    }
    if (!data.results || !data.results.length) { tmdbCache[ck] = null; return null; }
    const mid = data.results[0].id;
    const { data: det } = await axios.get(
      `https://api.themoviedb.org/3/movie/${mid}?api_key=${tmdbKey}&append_to_response=credits,external_ids`,
      { timeout: 8000 }
    );
    const result = {
      poster: det.poster_path ? `https://image.tmdb.org/t/p/w500${det.poster_path}` : null,
      background: det.backdrop_path ? `https://image.tmdb.org/t/p/w1280${det.backdrop_path}` : null,
      description: det.overview || null,
      imdbRating: det.vote_average ? det.vote_average.toFixed(1) : null,
      year: det.release_date ? new Date(det.release_date).getFullYear() : null,
      genres: det.genres ? det.genres.map(g => g.name) : [],
      runtime: det.runtime ? `${Math.floor(det.runtime/60)}h ${det.runtime%60}m` : null,
      director: det.credits?.crew?.find(c => c.job === "Director")?.name || null,
      cast: det.credits?.cast?.slice(0,5).map(c => c.name) || [],
      imdb_id: det.imdb_id || det.external_ids?.imdb_id || null,
    };
    tmdbCache[ck] = result;
    return result;
  } catch (err) {
    console.error("[TMDB]", title, err.message);
    tmdbCache[ck] = null;
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  FETCH & CACHE M3U
// ═══════════════════════════════════════════════════════════

async function getSource(m3uUrl) {
  const now = Date.now();
  const cached = sourceCache[m3uUrl];
  if (cached && (now - cached.ts) < REFRESH_MS) return cached;
  console.log("[M3U] Fetching:", m3uUrl.substring(0, 80));
  try {
    const { data } = await axios.get(m3uUrl, { timeout: 60000, responseType: "text",
      headers: { "User-Agent": "StremioM3UAddon/3.0" } });
    const items = parseM3U(typeof data === "string" ? data : String(data));
    const catalogMap = {};
    for (const item of items) {
      const g = item.group || "Uncategorized";
      if (!catalogMap[g]) catalogMap[g] = [];
      catalogMap[g].push(item);
    }
    for (const g of Object.keys(catalogMap)) {
      catalogMap[g].sort((a, b) => {
        if (a.year && b.year && a.year !== b.year) return b.year - a.year;
        if (a.imdbRating && b.imdbRating) return b.imdbRating - a.imdbRating;
        return (a.title || "").localeCompare(b.title || "");
      });
    }
    const groupTitles = Object.keys(catalogMap).sort();
    const result = { items, catalogMap, groupTitles, ts: now };
    sourceCache[m3uUrl] = result;
    console.log("[M3U] ✅", items.length, "items in", groupTitles.length, "groups");
    return result;
  } catch (err) {
    console.error("[M3U] ❌", err.message);
    if (cached) return cached;
    return { items: [], catalogMap: {}, groupTitles: [], ts: now };
  }
}

// ═══════════════════════════════════════════════════════════
//  BUILD STREMIO META
// ═══════════════════════════════════════════════════════════

async function toMeta(item, tmdbKey, full = false) {
  let poster = item.tvgLogo || null;
  let background = null, description = null;
  let genres = item.genre?.length ? [...item.genre] : [];
  let director = item.director, cast = item.stars?.length ? [...item.stars] : [];
  let imdbRating = item.imdbRating, runtime = item.duration, imdb_id = null, year = item.year;

  const needsTmdb = !poster || !description || genres.length === 0;
  if (needsTmdb && tmdbKey) {
    const tmdb = await fetchTMDB(item.title, item.year, tmdbKey);
    if (tmdb) {
      if (!poster && tmdb.poster) poster = tmdb.poster;
      if (!background && tmdb.background) background = tmdb.background;
      if (!description && tmdb.description) description = tmdb.description;
      if (!genres.length && tmdb.genres.length) genres = tmdb.genres;
      if (!director && tmdb.director) director = tmdb.director;
      if (!cast.length && tmdb.cast.length) cast = tmdb.cast;
      if (!imdbRating && tmdb.imdbRating) imdbRating = parseFloat(tmdb.imdbRating);
      if (!runtime && tmdb.runtime) runtime = tmdb.runtime;
      if (tmdb.imdb_id) imdb_id = tmdb.imdb_id;
      if (!year && tmdb.year) year = tmdb.year;
    }
  }

  if (!description) {
    const parts = [];
    if (imdbRating) parts.push("⭐ IMDB " + imdbRating);
    if (year) parts.push("📅 " + year);
    if (runtime) parts.push("⏱ " + runtime);
    if (genres.length) parts.push("🎭 " + genres.join(", "));
    if (director) parts.push("🎬 Director: " + director);
    if (item.writers) parts.push("✍️ Writers: " + item.writers);
    if (cast.length) parts.push("🌟 " + cast.join(", "));
    description = parts.join("\n") || item.rawName || item.title;
  }

  const meta = { id: item.id, type: item.type === "series" ? "series" : "movie", name: item.title };
  if (poster) meta.poster = poster;
  if (background) meta.background = background;
  else if (poster) meta.background = poster;
  if (description) meta.description = description;
  if (year) meta.year = year;
  if (genres.length) meta.genres = genres;
  if (runtime) meta.runtime = runtime;
  if (imdbRating) meta.imdbRating = imdbRating;
  if (director) meta.director = [director];
  if (cast.length) meta.cast = cast;
  if (full) {
    meta.behaviorHints = { defaultVideoId: item.id };
    if (imdb_id) meta.imdb_id = imdb_id;
  }
  return meta;
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function collectGenres(items) {
  const s = new Set();
  for (const it of items) {
    if (it.genre) it.genre.forEach(g => s.add(g));
    if (it.language) s.add(it.language);
  }
  return [...s].sort();
}

function groupIdToKey(catalogId, groupTitles) {
  for (const g of groupTitles) {
    if (catalogId === `m3u_${g.replace(/[^a-zA-Z0-9]/g, "_")}`) return g;
  }
  return null;
}

function buildManifest(source, baseUrl) {
  const { items, catalogMap, groupTitles } = source;
  const catalogs = [];
  if (items.length > 0) {
    catalogs.push({
      type: "movie", id: "m3u_all", name: "📺 All Movies",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: collectGenres(items) },
        { name: "skip", isRequired: false },
      ],
    });
  }
  for (const g of groupTitles) {
    catalogs.push({
      type: "movie", id: `m3u_${g.replace(/[^a-zA-Z0-9]/g, "_")}`, name: g,
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: collectGenres(catalogMap[g] || []) },
        { name: "skip", isRequired: false },
      ],
    });
  }
  return {
    id: "community.m3u.stremio.addon", version: "3.0.0",
    name: "M3U Stremio Addon",
    description: `Stream ${items.length} titles from M3U playlists with smart catalogs, sort & filter`,
    logo: "https://img.icons8.com/color/512/popcorn-time.png",
    resources: ["catalog", "meta", "stream"], types: ["movie"],
    catalogs,
    behaviorHints: { adult: false, configurable: true, configurationRequired: false },
    idPrefixes: ["m3u_"],
  };
}

// ═══════════════════════════════════════════════════════════
//  CONFIGURE PAGE — EMBEDDED HTML
// ═══════════════════════════════════════════════════════════

function getConfigureHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎬 M3U Stremio Addon — Configure</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a1a;color:#e0e0e0;min-height:100vh}
  .glow{position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:800px;height:800px;border-radius:50%;background:rgba(139,92,246,0.04);filter:blur(120px);pointer-events:none}
  .container{max-width:720px;margin:0 auto;padding:2rem 1rem;position:relative;z-index:1}
  .header{text-align:center;margin-bottom:2.5rem}
  .header h1{font-size:2rem;font-weight:800;background:linear-gradient(135deg,#a78bfa,#60a5fa,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .header p{color:#666;font-size:.85rem;margin-top:.5rem}
  .card{background:#111127;border:1px solid #1e1e3a;border-radius:1rem;overflow:hidden;margin-bottom:1.5rem}
  .card-header{padding:1.25rem 1.5rem;background:linear-gradient(135deg,rgba(139,92,246,.08),rgba(59,130,246,.08));border-bottom:1px solid #1e1e3a}
  .card-header h2{font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:.5rem}
  .card-header p{color:#555;font-size:.8rem;margin-top:.25rem}
  .card-body{padding:1.5rem}
  label{display:block;font-size:.85rem;font-weight:600;color:#bbb;margin-bottom:.5rem}
  label .req{color:#f87171}
  .input-row{display:flex;gap:.5rem}
  input[type="url"],input[type="text"]{flex:1;padding:.75rem 1rem;background:#0a0a1a;border:1px solid #2a2a4a;border-radius:.75rem;color:#e0e0e0;font-size:.85rem;outline:none;transition:border .2s}
  input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.15)}
  input::placeholder{color:#444}
  .btn{padding:.75rem 1.5rem;border:none;border-radius:.75rem;font-weight:700;font-size:.85rem;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:.5rem}
  .btn-primary{background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:#fff;box-shadow:0 4px 20px rgba(139,92,246,.2)}
  .btn-primary:hover{box-shadow:0 4px 30px rgba(139,92,246,.4);transform:translateY(-1px)}
  .btn-primary:disabled{background:#333;color:#666;box-shadow:none;cursor:not-allowed;transform:none}
  .btn-green{background:linear-gradient(135deg,#22c55e,#10b981);color:#fff;box-shadow:0 4px 20px rgba(34,197,94,.2);font-size:1.1rem;padding:1rem;width:100%;justify-content:center}
  .btn-green:hover{box-shadow:0 4px 30px rgba(34,197,94,.4);transform:translateY(-1px)}
  .btn-outline{background:rgba(139,92,246,.08);color:#a78bfa;border:1px solid rgba(139,92,246,.2);padding:.5rem 1rem;font-size:.75rem}
  .btn-outline:hover{background:rgba(139,92,246,.15);border-color:rgba(139,92,246,.4)}
  .spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block}
  @keyframes spin{to{transform:rotate(360deg)}}
  .tmdb-toggle{font-size:.8rem;color:#888;cursor:pointer;display:flex;align-items:center;gap:.5rem;margin-top:1rem;background:none;border:none;font-weight:600}
  .tmdb-toggle:hover{color:#bbb}
  .tag{display:inline-block;padding:.2rem .5rem;border-radius:.5rem;font-size:.65rem;font-weight:600}
  .tag-optional{background:rgba(34,197,94,.1);color:#4ade80;border:1px solid rgba(34,197,94,.15)}
  .hint{font-size:.72rem;color:#555;margin-top:.3rem}
  .hint a{color:#60a5fa;text-decoration:none}
  .hint a:hover{text-decoration:underline}
  .hidden{display:none}

  /* Stats */
  .hero-count{text-align:center;padding:2rem;background:linear-gradient(135deg,rgba(139,92,246,.08),#111127,rgba(59,130,246,.08));border:1px solid rgba(139,92,246,.15);border-radius:1rem;margin-bottom:1rem}
  .hero-count .num{font-size:3.5rem;font-weight:900;background:linear-gradient(135deg,#a78bfa,#60a5fa,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}
  .hero-count .label{color:#888;font-size:1rem;margin-top:.25rem}
  .hero-count .sub{color:#555;font-size:.8rem;margin-top:.15rem}
  .stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.75rem;margin-bottom:1rem}
  .stat-card{background:#0a0a1a;padding:1rem;border-radius:.75rem;border:1px solid #1e1e3a;text-align:center}
  .stat-card .icon{font-size:1.2rem;margin-bottom:.25rem}
  .stat-card .val{font-size:1.4rem;font-weight:800}
  .stat-card .lbl{font-size:.65rem;color:#555;margin-top:.15rem}
  .text-blue{color:#60a5fa} .text-green{color:#4ade80} .text-yellow{color:#facc15} .text-purple{color:#a78bfa} .text-red{color:#f87171}

  /* Groups */
  .group-item{border-bottom:1px solid #1e1e3a;overflow:hidden}
  .group-item:last-child{border-bottom:none}
  .group-btn{width:100%;display:flex;align-items:center;justify-content:space-between;padding:.75rem 1.25rem;background:none;border:none;color:#e0e0e0;cursor:pointer;text-align:left;transition:background .15s;font-size:.85rem}
  .group-btn:hover{background:#16162e}
  .group-name{font-weight:600;display:flex;align-items:center;gap:.5rem}
  .group-count{background:rgba(139,92,246,.15);color:#a78bfa;padding:.2rem .6rem;border-radius:2rem;font-size:.8rem;font-weight:700}
  .group-detail{padding:0 1.25rem 1rem;display:none}
  .group-detail.open{display:block}
  .group-meta{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;font-size:.75rem;color:#888;margin-bottom:.75rem}
  .group-genres{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.75rem}
  .genre-pill{padding:.2rem .5rem;background:#0a0a1a;border:1px solid #1e1e3a;border-radius:.35rem;font-size:.65rem;color:#888}
  .sample-item{display:flex;align-items:center;gap:.5rem;padding:.35rem 0;font-size:.75rem}
  .sample-poster{width:24px;height:36px;object-fit:cover;border-radius:.25rem;background:#1e1e3a}
  .sample-title{color:#ccc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sample-year{color:#555;font-size:.7rem}
  .sample-rating{color:#facc15;font-size:.7rem}

  /* Addon result */
  .addon-card{border-color:rgba(34,197,94,.2)}
  .addon-card .card-header{background:linear-gradient(135deg,rgba(34,197,94,.08),rgba(16,185,129,.08));border-bottom-color:rgba(34,197,94,.2)}
  .url-box{display:flex;align-items:center;gap:.5rem;background:#0a0a1a;padding:.75rem 1rem;border-radius:.75rem;border:1px solid #2a2a4a;margin-bottom:1rem}
  .url-box code{flex:1;font-size:.75rem;color:#60a5fa;word-break:break-all;font-family:'Courier New',monospace}
  .info-box{background:rgba(139,92,246,.04);border:1px solid rgba(139,92,246,.15);border-radius:.75rem;padding:1rem;margin-top:1rem}
  .info-box h4{color:#a78bfa;font-size:.85rem;margin-bottom:.35rem}
  .info-box p{color:#666;font-size:.75rem;line-height:1.5}

  /* Alert */
  .alert{padding:1rem 1.25rem;border-radius:.75rem;font-size:.8rem;margin-bottom:1rem;display:flex;align-items:flex-start;gap:.75rem}
  .alert-warn{background:rgba(250,204,21,.04);border:1px solid rgba(250,204,21,.15);color:#facc15}
  .alert-error{background:rgba(248,113,113,.04);border:1px solid rgba(248,113,113,.15);color:#f87171}
  .alert-text{color:#aaa;font-size:.78rem;line-height:1.5}

  /* Animate */
  @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .fade-in{animation:fadeIn .4s ease}
</style>
</head>
<body>
<div class="glow"></div>
<div class="container">

  <!-- HEADER -->
  <div class="header">
    <div style="font-size:3rem;margin-bottom:.5rem">🎬</div>
    <h1>M3U Stremio Addon</h1>
    <p>v3.0 · Enter your M3U source → See movie count → Install in Stremio</p>
  </div>

  <!-- STEP INDICATORS -->
  <div style="display:flex;align-items:center;justify-content:center;gap:.5rem;margin-bottom:2rem;flex-wrap:wrap;font-size:.8rem">
    <span id="step1" style="padding:.4rem .8rem;border-radius:.5rem;border:1px solid #1e1e3a;background:#111127;color:#555">📝 Enter URL</span>
    <span style="color:#333">→</span>
    <span id="step2" style="padding:.4rem .8rem;border-radius:.5rem;border:1px solid #1e1e3a;background:#111127;color:#555">🔍 Scan</span>
    <span style="color:#333">→</span>
    <span id="step3" style="padding:.4rem .8rem;border-radius:.5rem;border:1px solid #1e1e3a;background:#111127;color:#555">🔗 Get Link</span>
    <span style="color:#333">→</span>
    <span id="step4" style="padding:.4rem .8rem;border-radius:.5rem;border:1px solid #1e1e3a;background:#111127;color:#555">🍿 Watch!</span>
  </div>

  <!-- CONFIG FORM -->
  <div class="card">
    <div class="card-header">
      <h2>⚙️ Configure Your Source</h2>
      <p>Paste your raw M3U URL and we'll scan it for movies</p>
    </div>
    <div class="card-body">
      <label>M3U Playlist URL <span class="req">*</span></label>
      <div class="input-row">
        <input type="url" id="m3uUrl" placeholder="https://raw.githubusercontent.com/user/repo/main/playlist.m3u" required>
        <button class="btn btn-primary" id="scanBtn" onclick="scanSource()" disabled>🔍 Scan</button>
      </div>
      <p class="hint">Raw GitHub URL to your .m3u file. Must be publicly accessible.</p>

      <button class="tmdb-toggle" onclick="document.getElementById('tmdbSection').classList.toggle('hidden')">
        🎬 TMDB API Key <span class="tag tag-optional">Optional</span> <span id="tmdbArrow">▼</span>
      </button>
      <div id="tmdbSection" class="hidden" style="margin-top:.75rem">
        <input type="text" id="tmdbKey" placeholder="your-tmdb-api-key-here" style="font-family:monospace">
        <p class="hint">Auto-fetches missing posters &amp; metadata. <a href="https://www.themoviedb.org/settings/api" target="_blank">Get free key →</a></p>
      </div>
    </div>
  </div>

  <!-- RESULTS AREA -->
  <div id="results"></div>

</div>

<script>
const m3uInput = document.getElementById('m3uUrl');
const scanBtn = document.getElementById('scanBtn');
const resultsDiv = document.getElementById('results');

m3uInput.addEventListener('input', () => {
  scanBtn.disabled = !m3uInput.value.trim();
  setStep(1);
  resultsDiv.innerHTML = '';
});

function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('step' + i);
    if (i <= n) {
      el.style.background = 'rgba(139,92,246,0.12)';
      el.style.borderColor = 'rgba(139,92,246,0.3)';
      el.style.color = '#a78bfa';
    } else {
      el.style.background = '#111127';
      el.style.borderColor = '#1e1e3a';
      el.style.color = '#555';
    }
  }
}

async function scanSource() {
  const url = m3uInput.value.trim();
  if (!url) return;

  scanBtn.disabled = true;
  scanBtn.innerHTML = '<span class="spinner"></span> Scanning...';
  resultsDiv.innerHTML = '';

  try {
    const resp = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ m3uUrl: url })
    });
    const data = await resp.json();

    if (!data.ok) {
      resultsDiv.innerHTML = '<div class="alert alert-error fade-in"><span style="font-size:1.2rem">❌</span><div class="alert-text">' + escHtml(data.error) + '</div></div>';
      scanBtn.disabled = false;
      scanBtn.innerHTML = '🔍 Scan';
      return;
    }

    setStep(2);
    renderResults(data);
  } catch (err) {
    resultsDiv.innerHTML = '<div class="alert alert-error fade-in"><span style="font-size:1.2rem">❌</span><div class="alert-text">Network error: ' + escHtml(err.message) + '</div></div>';
  }

  scanBtn.disabled = false;
  scanBtn.innerHTML = '🔍 Scan';
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderResults(data) {
  const totalItems = data.items || 0;
  const groups = data.groupCounts || [];
  const groupNames = data.groups || [];

  let html = '';

  // Hero count
  html += '<div class="hero-count fade-in">';
  html += '<div class="num">' + totalItems.toLocaleString() + '</div>';
  html += '<div class="label">Movies Found</div>';
  html += '<div class="sub">in ' + groups.length + ' catalog' + (groups.length !== 1 ? 's' : '') + '</div>';
  html += '</div>';

  // Stats
  html += '<div class="stats-row fade-in">';
  html += statCard('📂', groups.length, 'Catalogs', 'text-blue');
  html += statCard('🎬', totalItems, 'Total Movies', 'text-purple');
  const biggest = groups.length ? groups.reduce((a, b) => a.count > b.count ? a : b) : null;
  html += statCard('🏆', biggest ? biggest.count : '—', biggest ? 'Largest Group' : 'N/A', 'text-yellow');
  const smallest = groups.length ? groups.reduce((a, b) => a.count < b.count ? a : b) : null;
  html += statCard('📦', smallest ? smallest.count : '—', smallest ? 'Smallest Group' : 'N/A', 'text-green');
  html += '</div>';

  // Catalog breakdown
  if (groups.length > 0) {
    html += '<div class="card fade-in">';
    html += '<div class="card-header"><h2>📂 Catalog Breakdown <span style="font-size:.75rem;color:#555;font-weight:400">(' + groups.length + ' groups)</span></h2></div>';
    html += '<div style="max-height:500px;overflow-y:auto">';
    for (const g of groups) {
      const gid = 'grp_' + g.name.replace(/[^a-zA-Z0-9]/g, '_');
      html += '<div class="group-item">';
      html += '<button class="group-btn" onclick="toggleGroup(\\'' + gid + '\\')">';
      html += '<span class="group-name">📁 ' + escHtml(g.name) + '</span>';
      html += '<span class="group-count">' + g.count + '</span>';
      html += '</button>';
      html += '<div class="group-detail" id="' + gid + '">';
      html += '<div class="group-meta"><div>Movies: <strong style="color:#a78bfa">' + g.count + '</strong></div></div>';
      html += '</div></div>';
    }
    html += '</div></div>';
  }

  // Generate button
  html += '<div style="text-align:center;margin:1.5rem 0" class="fade-in">';
  html += '<button class="btn btn-primary" style="font-size:1.1rem;padding:1rem 2.5rem" onclick="generateAddon()">🚀 Generate Addon URL</button>';
  html += '<p class="hint" style="margin-top:.5rem">Config encoded in URL — no data stored on server</p>';
  html += '</div>';

  // Addon result placeholder
  html += '<div id="addonResult"></div>';

  resultsDiv.innerHTML = html;
}

function statCard(icon, val, label, colorClass) {
  return '<div class="stat-card"><div class="icon">' + icon + '</div><div class="val ' + colorClass + '">' + val + '</div><div class="lbl">' + label + '</div></div>';
}

function toggleGroup(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

async function generateAddon() {
  const m3uUrl = m3uInput.value.trim();
  const tmdbKey = document.getElementById('tmdbKey').value.trim();
  if (!m3uUrl) return;

  try {
    const resp = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ m3uUrl, tmdbKey: tmdbKey || undefined })
    });
    const data = await resp.json();

    if (!data.ok) {
      document.getElementById('addonResult').innerHTML = '<div class="alert alert-error fade-in"><span>❌</span><div class="alert-text">' + escHtml(data.error) + '</div></div>';
      return;
    }

    setStep(3);

    let html = '<div class="card addon-card fade-in">';
    html += '<div class="card-header"><h2>🎉 Your Addon is Ready!</h2></div>';
    html += '<div class="card-body">';

    html += '<label>Manifest URL</label>';
    html += '<div class="url-box"><code id="manifestUrl">' + escHtml(data.manifestUrl) + '</code>';
    html += '<button class="btn btn-outline" onclick="copyText(\\'' + escHtml(data.manifestUrl).replace(/'/g, "\\\\'") + '\\')">📋 Copy</button></div>';

    html += '<a href="' + escHtml(data.stremioUrl) + '" class="btn btn-green" style="text-decoration:none;display:flex">📥 Install in Stremio</a>';

    html += '<p style="text-align:center;font-size:.75rem;color:#555;margin-top:.75rem">Or paste the manifest URL in Stremio → Addons → Search bar</p>';

    html += '<div class="info-box"><h4>💡 Want to change source?</h4><p>Come back here, enter a new M3U URL, scan, and install. Each source gets a unique URL — you can have multiple sources installed simultaneously!</p></div>';

    html += '</div></div>';

    document.getElementById('addonResult').innerHTML = html;
    document.getElementById('addonResult').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    document.getElementById('addonResult').innerHTML = '<div class="alert alert-error fade-in"><span>❌</span><div class="alert-text">' + escHtml(err.message) + '</div></div>';
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = orig, 2000);
  });
}

// Init step
if (m3uInput.value.trim()) setStep(1);
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════
//  EXPRESS APP
// ═══════════════════════════════════════════════════════════

const app = express();
app.use(cors());
app.use(express.json());

function getBaseUrl(req) {
  if (RENDER_URL) return RENDER_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

// ── Root → redirect to /configure ────────────────────────
app.get("/", (req, res) => res.redirect("/configure"));

// ── Configure page (embedded HTML) ──────────────────────
app.get("/configure", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(getConfigureHTML());
});

// ── API: Validate M3U URL ────────────────────────────────
app.post("/api/validate", async (req, res) => {
  const { m3uUrl } = req.body;
  if (!m3uUrl) return res.json({ ok: false, error: "No URL provided" });
  try {
    const source = await getSource(m3uUrl);
    res.json({
      ok: true,
      items: source.items.length,
      groups: source.groupTitles,
      groupCounts: source.groupTitles.map(g => ({
        name: g,
        count: (source.catalogMap[g] || []).length,
      })),
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── API: Generate config ─────────────────────────────────
app.post("/api/config", (req, res) => {
  const { m3uUrl, tmdbKey } = req.body;
  if (!m3uUrl) return res.json({ ok: false, error: "M3U URL is required" });
  const config = { m3uUrl };
  if (tmdbKey) config.tmdbKey = tmdbKey;
  const encoded = encodeConfig(config);
  const base = getBaseUrl(req);
  res.json({
    ok: true, configId: encoded,
    manifestUrl: `${base}/${encoded}/manifest.json`,
    stremioUrl: `stremio://${base.replace(/^https?:\/\//, "")}/${encoded}/manifest.json`,
  });
});

// ── Manifest ─────────────────────────────────────────────
app.get("/:config/manifest.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.status(400).json({ error: "Invalid config. Go to /configure to set up." });
  try {
    const source = await getSource(cfg.m3uUrl);
    const base = getBaseUrl(req);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(buildManifest(source, base));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catalog ──────────────────────────────────────────────
app.get("/:config/catalog/:type/:id/:extra?.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ metas: [] });
  try {
    const source = await getSource(cfg.m3uUrl);
    const tmdbKey = cfg.tmdbKey || DEFAULT_TMDB;
    const { id } = req.params;
    const extras = {};
    const extraStr = req.params.extra || "";
    if (extraStr) {
      decodeURIComponent(extraStr).split("&").forEach(p => {
        const eq = p.indexOf("=");
        if (eq !== -1) extras[p.slice(0, eq)] = p.slice(eq + 1);
      });
    }
    const search = (extras.search || "").toLowerCase();
    const genre = extras.genre || "";
    const skip = parseInt(extras.skip, 10) || 0;
    const limit = 100;

    let items;
    if (id === "m3u_all") {
      items = [...source.items];
    } else {
      const groupKey = groupIdToKey(id, source.groupTitles);
      items = groupKey ? [...(source.catalogMap[groupKey] || [])] : [];
    }

    if (search) {
      items = items.filter(i =>
        (i.title || "").toLowerCase().includes(search) ||
        (i.rawName || "").toLowerCase().includes(search) ||
        (i.director || "").toLowerCase().includes(search) ||
        (i.stars || []).some(s => s.toLowerCase().includes(search))
      );
    }
    if (genre) {
      items = items.filter(i =>
        (i.genre || []).includes(genre) || i.language === genre
      );
    }

    items.sort((a, b) => {
      if (a.year && b.year && a.year !== b.year) return b.year - a.year;
      if (a.imdbRating && b.imdbRating && a.imdbRating !== b.imdbRating) return b.imdbRating - a.imdbRating;
      return (a.title || "").localeCompare(b.title || "");
    });

    const page = items.slice(skip, skip + limit);
    const metas = [];
    const BATCH = 5;
    for (let i = 0; i < page.length; i += BATCH) {
      const batch = page.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(it => toMeta(it, tmdbKey, false)));
      metas.push(...results);
    }
    res.json({ metas });
  } catch (err) {
    console.error("[CATALOG] Error:", err.message);
    res.json({ metas: [] });
  }
});

// ── Meta ─────────────────────────────────────────────────
app.get("/:config/meta/:type/:id.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ meta: null });
  try {
    const source = await getSource(cfg.m3uUrl);
    const tmdbKey = cfg.tmdbKey || DEFAULT_TMDB;
    const item = source.items.find(i => i.id === req.params.id);
    if (!item) return res.json({ meta: null });
    const meta = await toMeta(item, tmdbKey, true);
    res.json({ meta });
  } catch (err) {
    console.error("[META] Error:", err.message);
    res.json({ meta: null });
  }
});

// ── Stream ───────────────────────────────────────────────
app.get("/:config/stream/:type/:id.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ streams: [] });
  try {
    const source = await getSource(cfg.m3uUrl);
    const item = source.items.find(i => i.id === req.params.id);
    if (!item || !item.streamUrl) return res.json({ streams: [] });
    res.json({
      streams: [{
        title: `▶️ ${item.title}${item.duration ? ` (${item.duration})` : ""}${item.group ? `\n📂 ${item.group}` : ""}`,
        url: item.streamUrl,
        behaviorHints: { notWebReady: false, bingeGroup: item.group || "default" },
      }],
    });
  } catch (err) {
    console.error("[STREAM] Error:", err.message);
    res.json({ streams: [] });
  }
});

// ── Health ───────────────────────────────────────────────
app.get("/health", (req, res) => {
  const sources = Object.keys(sourceCache).length;
  const totalItems = Object.values(sourceCache).reduce((s, c) => s + c.items.length, 0);
  res.json({
    status: "ok", sources, totalItems,
    tmdbCacheSize: Object.keys(tmdbCache).length,
    uptime: Math.floor(process.uptime()),
    keepAlive: !!RENDER_URL,
  });
});

// ═══════════════════════════════════════════════════════════
//  KEEP-ALIVE
// ═══════════════════════════════════════════════════════════

function startKeepAlive() {
  if (!RENDER_URL) {
    console.log("[KEEP-ALIVE] ⚠ RENDER_EXTERNAL_URL not set — disabled.");
    return;
  }
  const pingUrl = `${RENDER_URL}/health`;
  console.log(`[KEEP-ALIVE] ✅ Pinging ${pingUrl} every ${KEEP_ALIVE_MS / 60000} min`);
  setInterval(async () => {
    try {
      const { data } = await axios.get(pingUrl, { timeout: 15000 });
      console.log(`[KEEP-ALIVE] ✅ OK — ${data.totalItems} items, uptime ${data.uptime}s`);
    } catch (err) {
      console.error("[KEEP-ALIVE] ❌", err.message);
    }
  }, KEEP_ALIVE_MS);
}

// Cache cleanup (evict sources not accessed in 24h)
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600000;
  for (const url of Object.keys(sourceCache)) {
    if (sourceCache[url].ts < cutoff) {
      console.log(`[CACHE] Evicting: ${url.substring(0, 60)}...`);
      delete sourceCache[url];
    }
  }
}, 3600000);

// ═══════════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════════

app.listen(PORT, "0.0.0.0", () => {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  🎬 Stremio M3U Addon Server v3.0            ║");
  console.log("║  Self-contained — configure page embedded     ║");
  console.log("╠═══════════════════════════════════════════════╣");
  console.log(`║  PORT:       ${PORT}`);
  console.log(`║  Render URL: ${RENDER_URL || "N/A"}`);
  console.log(`║  TMDB key:   ${DEFAULT_TMDB ? "✅ (server default)" : "❌ (user provides)"}`);
  console.log(`║  Refresh:    Every ${REFRESH_HOURS}h`);
  console.log("╚═══════════════════════════════════════════════╝");
  console.log(`\n🚀  http://localhost:${PORT}`);
  console.log(`📺  http://localhost:${PORT}/configure\n`);
  startKeepAlive();
});
