// ============================================================
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
let catalogMap = {};        // groupTitle → items[]
let groupTitles = [];
let lastRefresh = null;
let tmdbCache = {};         // "title|year" → tmdb details

// ── M3U PARSER ───────────────────────────────────────────────
function parseM3U(content) {
  const lines = content.split("\n");
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
    const r = new RegExp(`${key}="([^"]*)"`, "i");
    const m = line.match(r);
    return m ? m[1] : "";
  };

  const type = attr("type") || "movie";
  const logo = attr("tvg-logo");
  const groupLogo = attr("group-logo");
  const group = attr("group-title");

  // Name is everything after the last comma in the #EXTINF line
  const commaIdx = line.lastIndexOf(",");
  const rawName = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : "";

  const details = parseMovieDetails(rawName);

  return { type, logo, groupLogo, group, rawName, ...details };
}

function parseMovieDetails(name) {
  const d = {
    title: name,
    year: null,
    genre: [],
    duration: null,
    director: null,
    writers: null,
    stars: [],
    imdbRating: null,
    language: null,
  };

  // IMDB rating (bold unicode digits)
  const imdb = name.match(/[𝗜I][𝗠M][𝗗D][𝗕B]\s*([\d.]+)/i);
  if (imdb) d.imdbRating = parseFloat(imdb[1]);

  // Year
  const yrAll = [...name.matchAll(/\b((?:19|20)\d{2})\b/g)];
  if (yrAll.length) d.year = parseInt(yrAll[0][1], 10);

  // Title: text before the opening parenthesis (or before IMDB)
  const titleM = name.match(/^([^(𝗜]*)/);
  if (titleM) {
    let t = titleM[1].trim();
    if (t.endsWith("(")) t = t.slice(0, -1).trim();
    if (t) d.title = t;
  }

  // Genre from ‧-separated segment: "Comedy\Drama\Hindi"
  const genreM = name.match(/‧\s*([A-Za-z\\\/|]+(?:\s*[A-Za-z\\\/|]+)*)\s*‧/);
  if (genreM) {
    d.genre = genreM[1]
      .split(/[\\\/|]/)
      .map((g) => g.trim())
      .filter(Boolean);
    // last element might be language
    if (d.genre.length > 0) {
      const last = d.genre[d.genre.length - 1];
      const langs = ["Hindi", "Tamil", "Telugu", "Malayalam", "Kannada", "Bengali", "English", "Korean", "Japanese"];
      if (langs.includes(last)) {
        d.language = last;
      }
    }
  }

  // Duration
  const dur = name.match(/(\d+h\s*\d*m?)/i);
  if (dur) d.duration = dur[1];

  // Director
  const dir = name.match(/Directors?\s+([^|)]+)/i);
  if (dir) d.director = dir[1].trim();

  // Writers
  const wri = name.match(/Writers?\s+([^|)]+)/i);
  if (wri) d.writers = wri[1].trim();

  // Stars
  const sta = name.match(/Stars?\s+(.+?)(?:\)|$)/i);
  if (sta) {
    d.stars = sta[1]
      .split("‧")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return d;
}

function generateId(item) {
  const base = `${item.title}__${item.year || "0"}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `m3u_${base}`;
}

// ── TMDB FALLBACK ────────────────────────────────────────────
async function fetchTMDB(title, year) {
  if (!TMDB_API_KEY) return null;
  const key = `${title}|${year || ""}`;
  if (tmdbCache[key] !== undefined) return tmdbCache[key];

  try {
    const q = encodeURIComponent(title);
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${q}${year ? `&year=${year}` : ""}`;
    const { data } = await axios.get(searchUrl, { timeout: 8000 });

    if (!data.results || data.results.length === 0) {
      // Try without year
      if (year) {
        const { data: d2 } = await axios.get(
          `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${q}`,
          { timeout: 8000 }
        );
        if (!d2.results || d2.results.length === 0) { tmdbCache[key] = null; return null; }
        data.results = d2.results;
      } else {
        tmdbCache[key] = null;
        return null;
      }
    }

    const movie = data.results[0];
    const detUrl = `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}&append_to_response=credits,external_ids`;
    const { data: det } = await axios.get(detUrl, { timeout: 8000 });

    const result = {
      poster: det.poster_path ? `https://image.tmdb.org/t/p/w500${det.poster_path}` : null,
      background: det.backdrop_path ? `https://image.tmdb.org/t/p/w1280${det.backdrop_path}` : null,
      description: det.overview || null,
      imdbRating: det.vote_average ? det.vote_average.toFixed(1) : null,
      year: det.release_date ? new Date(det.release_date).getFullYear() : null,
      genres: det.genres ? det.genres.map((g) => g.name) : [],
      runtime: det.runtime ? `${Math.floor(det.runtime / 60)}h ${det.runtime % 60}m` : null,
      director: det.credits?.crew?.find((c) => c.job === "Director")?.name || null,
      cast: det.credits?.cast?.slice(0, 5).map((c) => c.name) || [],
      imdb_id: det.imdb_id || det.external_ids?.imdb_id || null,
      tmdb_id: det.id,
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
  if (!M3U_URL) {
    console.warn("[M3U] No M3U_URL configured.");
    return;
  }

  console.log(`[M3U] Refreshing from: ${M3U_URL}`);
  try {
    const { data } = await axios.get(M3U_URL, {
      timeout: 30000,
      responseType: "text",
      headers: { "User-Agent": "StremioAddon/1.0" },
    });

    const items = parseM3U(data);
    console.log(`[M3U] Parsed ${items.length} items`);

    // Build catalog map
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

    console.log(`[M3U] Groups: ${groupTitles.join(", ")}`);
    console.log(`[M3U] Refresh complete at ${lastRefresh.toISOString()}`);
  } catch (err) {
    console.error("[M3U] Refresh error:", err.message);
  }
}

// ── BUILD STREMIO META ───────────────────────────────────────
async function buildMeta(item, full = false) {
  let poster = item.logo || null;
  let background = null;
  let description = null;
  let genres = item.genre && item.genre.length > 0 ? item.genre : [];
  let director = item.director;
  let cast = item.stars || [];
  let imdbRating = item.imdbRating;
  let runtime = item.duration;
  let imdb_id = null;
  let year = item.year;

  // Determine if we need TMDB fallback
  const needsFallback = !poster || !description || genres.length === 0;

  if (needsFallback && TMDB_API_KEY) {
    const tmdb = await fetchTMDB(item.title, item.year);
    if (tmdb) {
      if (!poster && tmdb.poster) poster = tmdb.poster;
      if (!background && tmdb.background) background = tmdb.background;
      if (!description && tmdb.description) description = tmdb.description;
      if (genres.length === 0 && tmdb.genres.length > 0) genres = tmdb.genres;
      if (!director && tmdb.director) director = tmdb.director;
      if (cast.length === 0 && tmdb.cast.length > 0) cast = tmdb.cast;
      if (!imdbRating && tmdb.imdbRating) imdbRating = parseFloat(tmdb.imdbRating);
      if (!runtime && tmdb.runtime) runtime = tmdb.runtime;
      if (tmdb.imdb_id) imdb_id = tmdb.imdb_id;
      if (!year && tmdb.year) year = tmdb.year;
    }
  }

  // Build description from parsed details if still missing
  if (!description) {
    const parts = [];
    if (imdbRating) parts.push(`⭐ IMDB ${imdbRating}`);
    if (year) parts.push(`📅 ${year}`);
    if (runtime) parts.push(`⏱ ${runtime}`);
    if (director) parts.push(`🎬 Director: ${director}`);
    if (item.writers) parts.push(`✍️ Writers: ${item.writers}`);
    if (cast.length) parts.push(`🌟 Stars: ${cast.join(", ")}`);
    if (genres.length) parts.push(`🎭 ${genres.join(", ")}`);
    description = parts.join("\n") || item.rawName;
  }

  const meta = {
    id: item.id,
    type: item.type === "series" ? "series" : "movie",
    name: item.title,
    poster: poster || undefined,
    background: background || poster || undefined,
    description: description,
    year: year || undefined,
    genres: genres.length > 0 ? genres : undefined,
    runtime: runtime || undefined,
    imdbRating: imdbRating || undefined,
    director: director ? [director] : undefined,
    cast: cast.length > 0 ? cast : undefined,
  };

  if (full) {
    meta.behaviorHints = { defaultVideoId: item.id };
    if (imdb_id) meta.imdb_id = imdb_id;
  }

  // Remove undefined fields
  return Object.fromEntries(Object.entries(meta).filter(([_, v]) => v !== undefined));
}

// ── MANIFEST ─────────────────────────────────────────────────
function buildManifest() {
  const catalogs = groupTitles.map((g) => ({
    type: "movie",
    id: `m3u_${g.replace(/[^a-zA-Z0-9]/g, "_")}`,
    name: g,
    extra: [
      { name: "search", isRequired: false },
      { name: "genre", isRequired: false, options: getGenresForGroup(g) },
      {
        name: "skip",
        isRequired: false,
      },
    ],
  }));

  // Add an "All Movies" catalog
  if (groupTitles.length > 0) {
    catalogs.unshift({
      type: "movie",
      id: "m3u_all",
      name: "📺 All Movies",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: getAllGenres() },
        { name: "skip", isRequired: false },
      ],
    });
  }

  return {
    id: "community.m3u.stremio.addon",
    version: "1.0.0",
    name: "M3U Stremio Addon",
    description: "Stream movies from M3U playlists with TMDB metadata, sorting & filtering",
    logo: "https://img.icons8.com/color/512/popcorn-time.png",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    catalogs: catalogs,
    behaviorHints: {
      adult: false,
      configurable: false,
      configurationRequired: false,
    },
    idPrefixes: ["m3u_"],
  };
}

function getGenresForGroup(group) {
  const items = catalogMap[group] || [];
  const genreSet = new Set();
  for (const item of items) {
    if (item.genre) item.genre.forEach((g) => genreSet.add(g));
    if (item.language) genreSet.add(item.language);
  }
  return [...genreSet].sort();
}

function getAllGenres() {
  const genreSet = new Set();
  for (const item of allItems) {
    if (item.genre) item.genre.forEach((g) => genreSet.add(g));
    if (item.language) genreSet.add(item.language);
  }
  return [...genreSet].sort();
}

// ── EXPRESS SERVER ───────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Landing page
app.get("/", (req, res) => {
  const manifest = buildManifest();
  const installLink = `${getBaseUrl(req)}/manifest.json`;
  const stremioLink = `stremio://${installLink.replace(/^https?:\/\//, "")}`;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${manifest.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a1a; color: #e0e0e0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; }
    .container { max-width: 600px; text-align: center; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; background: linear-gradient(135deg, #7b5ea7, #4a90d9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .desc { color: #999; margin-bottom: 2rem; }
    .stats { display: flex; gap: 1rem; justify-content: center; margin-bottom: 2rem; flex-wrap: wrap; }
    .stat { background: #1a1a2e; padding: 0.75rem 1.25rem; border-radius: 8px; border: 1px solid #333; }
    .stat strong { color: #7b5ea7; }
    .install-btn { display: inline-block; padding: 1rem 2rem; background: linear-gradient(135deg, #7b5ea7, #4a90d9); color: white; text-decoration: none; border-radius: 12px; font-size: 1.1rem; font-weight: 600; transition: transform 0.2s; }
    .install-btn:hover { transform: scale(1.05); }
    .manifest-url { margin-top: 1.5rem; background: #1a1a2e; padding: 0.75rem; border-radius: 8px; word-break: break-all; font-size: 0.85rem; color: #4a90d9; border: 1px solid #333; }
    .groups { margin-top: 2rem; text-align: left; }
    .groups h3 { margin-bottom: 0.5rem; }
    .group-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .group-tag { background: #1a1a2e; padding: 0.4rem 0.8rem; border-radius: 20px; font-size: 0.8rem; border: 1px solid #333; }
    .refresh { margin-top: 1rem; font-size: 0.8rem; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎬 ${manifest.name}</h1>
    <p class="desc">${manifest.description}</p>
    <div class="stats">
      <div class="stat"><strong>${allItems.length}</strong> Movies</div>
      <div class="stat"><strong>${groupTitles.length}</strong> Categories</div>
      <div class="stat"><strong>${TMDB_API_KEY ? "✅" : "❌"}</strong> TMDB</div>
    </div>
    <a href="${stremioLink}" class="install-btn">📥 Install in Stremio</a>
    <div class="manifest-url">${installLink}</div>
    ${groupTitles.length > 0 ? `
    <div class="groups">
      <h3>📂 Categories</h3>
      <div class="group-list">
        ${groupTitles.map((g) => `<span class="group-tag">${g} (${catalogMap[g].length})</span>`).join("")}
      </div>
    </div>` : ""}
    <p class="refresh">Last refresh: ${lastRefresh ? lastRefresh.toISOString() : "Never"} • Auto-refreshes every ${REFRESH_HOURS}h</p>
  </div>
</body>
</html>`);
});

// Manifest
app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(buildManifest());
});

// Catalog handler
app.get("/catalog/:type/:id/:extra?.json", async (req, res) => {
  try {
    const { type, id } = req.params;
    const extraStr = req.params.extra || "";

    // Parse extras
    const extras = {};
    if (extraStr) {
      const decoded = decodeURIComponent(extraStr);
      const pairs = decoded.split("&");
      for (const pair of pairs) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx !== -1) {
          extras[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1);
        }
      }
    }

    const search = extras.search || "";
    const genre = extras.genre || "";
    const skip = parseInt(extras.skip, 10) || 0;
    const limit = 100;

    // Get items for this catalog
    let items = [];
    if (id === "m3u_all") {
      items = [...allItems];
    } else {
      // Find group matching this catalog id
      for (const g of groupTitles) {
        const catId = `m3u_${g.replace(/[^a-zA-Z0-9]/g, "_")}`;
        if (catId === id) {
          items = [...(catalogMap[g] || [])];
          break;
        }
      }
    }

    // Apply search filter
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.rawName.toLowerCase().includes(q) ||
          (i.stars && i.stars.some((s) => s.toLowerCase().includes(q))) ||
          (i.director && i.director.toLowerCase().includes(q))
      );
    }

    // Apply genre filter
    if (genre) {
      items = items.filter(
        (i) =>
          (i.genre && i.genre.includes(genre)) ||
          (i.language && i.language === genre)
      );
    }

    // Sort: by year descending, then alphabetically
    items.sort((a, b) => {
      if (a.year && b.year && a.year !== b.year) return b.year - a.year;
      if (a.imdbRating && b.imdbRating && a.imdbRating !== b.imdbRating) return b.imdbRating - a.imdbRating;
      return a.title.localeCompare(b.title);
    });

    // Paginate
    const paged = items.slice(skip, skip + limit);

    // Build metas (concurrently but throttled)
    const metas = [];
    const BATCH = 10;
    for (let i = 0; i < paged.length; i += BATCH) {
      const batch = paged.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((item) => buildMeta(item, false)));
      metas.push(...results);
    }

    res.json({ metas });
  } catch (err) {
    console.error("[CATALOG] Error:", err);
    res.json({ metas: [] });
  }
});

// Meta handler
app.get("/meta/:type/:id.json", async (req, res) => {
  try {
    const { id } = req.params;
    const item = allItems.find((i) => i.id === id);
    if (!item) return res.json({ meta: null });

    const meta = await buildMeta(item, true);
    res.json({ meta });
  } catch (err) {
    console.error("[META] Error:", err);
    res.json({ meta: null });
  }
});

// Stream handler
app.get("/stream/:type/:id.json", (req, res) => {
  try {
    const { id } = req.params;
    const item = allItems.find((i) => i.id === id);

    if (!item || !item.url) {
      return res.json({ streams: [] });
    }

    const streams = [
      {
        title: `▶️ ${item.title}${item.duration ? ` (${item.duration})` : ""}`,
        url: item.url,
        behaviorHints: {
          notWebReady: false,
          bingeGroup: item.group || "default",
        },
      },
    ];

    res.json({ streams });
  } catch (err) {
    console.error("[STREAM] Error:", err);
    res.json({ streams: [] });
  }
});

// Health/status endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    items: allItems.length,
    groups: groupTitles.length,
    lastRefresh: lastRefresh ? lastRefresh.toISOString() : null,
    tmdb: !!TMDB_API_KEY,
    uptime: process.uptime(),
  });
});

// ── HELPERS ──────────────────────────────────────────────────
function getBaseUrl(req) {
  if (RENDER_EXTERNAL_URL) return RENDER_EXTERNAL_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

// ── KEEP-ALIVE (Render free tier) ────────────────────────────
function startKeepAlive() {
  if (!RENDER_EXTERNAL_URL) {
    console.log("[KEEP-ALIVE] No RENDER_EXTERNAL_URL set, skipping keep-alive pinger.");
    return;
  }

  console.log(`[KEEP-ALIVE] Pinging ${RENDER_EXTERNAL_URL}/health every ${KEEP_ALIVE_MS / 60000} minutes`);

  setInterval(async () => {
    try {
      const { data } = await axios.get(`${RENDER_EXTERNAL_URL}/health`, { timeout: 10000 });
      console.log(`[KEEP-ALIVE] Ping OK — ${data.items} items, uptime: ${Math.floor(data.uptime)}s`);
    } catch (err) {
      console.error("[KEEP-ALIVE] Ping failed:", err.message);
    }
  }, KEEP_ALIVE_MS);
}

// ── AUTO-REFRESH ─────────────────────────────────────────────
function startAutoRefresh() {
  console.log(`[REFRESH] Auto-refresh every ${REFRESH_HOURS} hours`);
  setInterval(() => {
    refreshM3U();
  }, REFRESH_MS);
}

// ── START ────────────────────────────────────────────────────
async function start() {
  console.log("============================================");
  console.log("  🎬 Stremio M3U Addon Server Starting...");
  console.log("============================================");
  console.log(`  M3U URL: ${M3U_URL ? M3U_URL.substring(0, 60) + "..." : "NOT SET"}`);
  console.log(`  TMDB:    ${TMDB_API_KEY ? "Configured ✅" : "Not configured ❌"}`);
  console.log(`  PORT:    ${PORT}`);
  console.log(`  Render:  ${RENDER_EXTERNAL_URL || "N/A"}`);
  console.log("============================================");

  // Initial fetch
  await refreshM3U();

  // Start server
  app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`   Manifest: http://localhost:${PORT}/manifest.json`);
    console.log(`   Health:   http://localhost:${PORT}/health\n`);

    // Start background tasks
    startAutoRefresh();
    startKeepAlive();
  });
}

start().catch(console.error);
