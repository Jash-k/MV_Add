// ============================================================
//  Stremio M3U Addon Server v2.0
//  ─────────────────────────────────────────────────────────
//  ✅ M3U parsing with smart metadata extraction
//  ✅ TMDB fallback for missing posters/details (env: TMDB_API_KEY)
//  ✅ Auto-refresh M3U source every N hours (env: REFRESH_HOURS)
//  ✅ Render free-tier keep-alive self-ping (env: RENDER_EXTERNAL_URL)
//  ✅ Sort by year + IMDB rating, genre filter, search in Stremio
//  ✅ Each group-title → separate Stremio catalog
// ============================================================

const express = require("express");
const cors = require("cors");
const axios = require("axios");

// ── ENV ──────────────────────────────────────────────────────
const M3U_URL          = process.env.M3U_URL || "";
const TMDB_API_KEY     = process.env.TMDB_API_KEY || "";
const PORT             = parseInt(process.env.PORT, 10) || 7000;
const RENDER_URL       = process.env.RENDER_EXTERNAL_URL || "";
const REFRESH_HOURS    = parseInt(process.env.REFRESH_HOURS, 10) || 6;
const REFRESH_MS       = REFRESH_HOURS * 3600000;
const KEEP_ALIVE_MS    = 10 * 60000; // 10 min

// ── RUNTIME CACHE ────────────────────────────────────────────
let allItems     = [];
let catalogMap   = {};   // groupTitle → items[]
let groupTitles  = [];
let lastRefresh  = null;
const tmdbCache  = {};   // "title|year" → tmdb result

// ═════════════════════════════════════════════════════════════
//  M3U PARSER
// ═════════════════════════════════════════════════════════════

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
  // Extract quoted attributes
  const getAttr = (key) => {
    const m = line.match(new RegExp(key + '="([^"]*)"', "i"));
    return m ? m[1].trim() : "";
  };

  const type      = getAttr("type") || "movie";
  const tvgLogo   = getAttr("tvg-logo");
  const groupLogo = getAttr("group-logo");
  const group     = getAttr("group-title");

  // Display name = everything after the LAST comma
  const ci = line.lastIndexOf(",");
  const rawName = ci !== -1 ? line.substring(ci + 1).trim() : "";

  return { type, tvgLogo, groupLogo, group, rawName, ...parseDisplayName(rawName) };
}

function parseDisplayName(name) {
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

  if (!name) return d;

  // ── IMDB rating  (handles bold unicode 𝗜𝗠𝗗𝗕 and plain IMDB)
  const imdbM = name.match(/[I\u{1D5DC}][M\u{1D5E0}][D\u{1D5D7}][B\u{1D5D5}]\s*([\d.]+)/iu);
  if (imdbM) d.imdbRating = parseFloat(imdbM[1]);

  // ── Year
  const years = [...name.matchAll(/\b((?:19|20)\d{2})\b/g)];
  if (years.length) d.year = parseInt(years[0][1], 10);

  // ── Title: text before first "(" or before IMDB marker
  const tM = name.match(/^([^(]*?)(?:\s*\(|$)/);
  if (tM && tM[1].trim()) {
    d.title = tM[1].trim();
  }

  // ── Genres from ‧-delimited section:  ‧ Comedy\Drama\Hindi ‧
  const gM = name.match(/‧\s*([\w\s\\\/|]+(?:\s*[\w\s\\\/|]+)*)\s*‧/);
  if (gM) {
    d.genre = gM[1].split(/[\\\/|]/).map(g => g.trim()).filter(Boolean);
    // Detect language (last element if it's a known language)
    const langs = ["Hindi","Tamil","Telugu","Malayalam","Kannada","Bengali","English","Korean","Japanese","Marathi","Punjabi","Gujarati","Urdu","Chinese","Spanish","French","German","Italian","Portuguese","Arabic","Turkish","Thai","Vietnamese","Indonesian","Malay","Filipino"];
    const last = d.genre[d.genre.length - 1];
    if (last && langs.some(l => l.toLowerCase() === last.toLowerCase())) {
      d.language = last;
    }
  }

  // ── Duration  e.g. 2h 10m
  const durM = name.match(/(\d+h\s*\d*m?)/i);
  if (durM) d.duration = durM[1];

  // ── Director
  const dirM = name.match(/Directors?\s+([^|)]+)/i);
  if (dirM) d.director = dirM[1].trim().replace(/\s+/g, " ");

  // ── Writers
  const wriM = name.match(/Writers?\s+([^|)]+)/i);
  if (wriM) d.writers = wriM[1].trim().replace(/\s+/g, " ");

  // ── Stars  (split by ‧)
  const staM = name.match(/Stars?\s+(.+?)(?:\)|$)/i);
  if (staM) {
    d.stars = staM[1].split("‧").map(s => s.trim()).filter(Boolean);
  }

  return d;
}

function makeId(item) {
  const slug = `${item.title}__${item.year || "0"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `m3u_${slug}`;
}

// ═════════════════════════════════════════════════════════════
//  TMDB FALLBACK
// ═════════════════════════════════════════════════════════════

async function fetchTMDB(title, year) {
  if (!TMDB_API_KEY) return null;
  const cacheKey = `${title}|${year || ""}`;
  if (cacheKey in tmdbCache) return tmdbCache[cacheKey];

  try {
    const q = encodeURIComponent(title);
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${q}`;
    if (year) url += `&year=${year}`;

    let { data } = await axios.get(url, { timeout: 8000 });

    // Retry without year if no results
    if ((!data.results || !data.results.length) && year) {
      const r2 = await axios.get(
        `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${q}`,
        { timeout: 8000 }
      );
      data = r2.data;
    }

    if (!data.results || !data.results.length) {
      tmdbCache[cacheKey] = null;
      return null;
    }

    const movieId = data.results[0].id;
    const { data: det } = await axios.get(
      `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&append_to_response=credits,external_ids`,
      { timeout: 8000 }
    );

    const result = {
      poster:      det.poster_path   ? `https://image.tmdb.org/t/p/w500${det.poster_path}` : null,
      background:  det.backdrop_path ? `https://image.tmdb.org/t/p/w1280${det.backdrop_path}` : null,
      description: det.overview || null,
      imdbRating:  det.vote_average  ? det.vote_average.toFixed(1) : null,
      year:        det.release_date  ? new Date(det.release_date).getFullYear() : null,
      genres:      det.genres        ? det.genres.map(g => g.name) : [],
      runtime:     det.runtime       ? `${Math.floor(det.runtime / 60)}h ${det.runtime % 60}m` : null,
      director:    det.credits?.crew?.find(c => c.job === "Director")?.name || null,
      cast:        det.credits?.cast?.slice(0, 5).map(c => c.name) || [],
      imdb_id:     det.imdb_id || det.external_ids?.imdb_id || null,
    };

    tmdbCache[cacheKey] = result;
    return result;
  } catch (err) {
    console.error("[TMDB] Error for", title, ":", err.message);
    tmdbCache[cacheKey] = null;
    return null;
  }
}

// ═════════════════════════════════════════════════════════════
//  REFRESH M3U
// ═════════════════════════════════════════════════════════════

async function refreshM3U() {
  if (!M3U_URL) {
    console.warn("[M3U] ⚠ No M3U_URL configured — set it as an environment variable.");
    return;
  }

  console.log(`[M3U] Refreshing from: ${M3U_URL.substring(0, 80)}...`);
  try {
    const { data } = await axios.get(M3U_URL, {
      timeout: 60000,
      responseType: "text",
      headers: { "User-Agent": "StremioM3UAddon/2.0" },
    });

    const items = parseM3U(typeof data === "string" ? data : String(data));
    console.log(`[M3U] Parsed ${items.length} items`);

    // Group by group-title
    const map = {};
    for (const item of items) {
      const g = item.group || "Uncategorized";
      if (!map[g]) map[g] = [];
      map[g].push(item);
    }

    // Sort each group: year desc → imdb desc → title asc
    for (const g of Object.keys(map)) {
      map[g].sort((a, b) => {
        if (a.year && b.year && a.year !== b.year) return b.year - a.year;
        if (a.imdbRating && b.imdbRating && a.imdbRating !== b.imdbRating) return b.imdbRating - a.imdbRating;
        return (a.title || "").localeCompare(b.title || "");
      });
    }

    allItems    = items;
    catalogMap  = map;
    groupTitles = Object.keys(map).sort();
    lastRefresh = new Date();

    console.log(`[M3U] ✅ ${items.length} items in ${groupTitles.length} groups`);
    console.log(`[M3U] Groups: ${groupTitles.join(" | ")}`);
  } catch (err) {
    console.error("[M3U] ❌ Refresh error:", err.message);
  }
}

// ═════════════════════════════════════════════════════════════
//  BUILD STREMIO META OBJECT
// ═════════════════════════════════════════════════════════════

async function toStremiOMeta(item, full = false) {
  let poster      = item.tvgLogo || null;
  let background  = null;
  let description = null;
  let genres      = item.genre && item.genre.length ? [...item.genre] : [];
  let director    = item.director;
  let cast        = item.stars && item.stars.length ? [...item.stars] : [];
  let imdbRating  = item.imdbRating;
  let runtime     = item.duration;
  let imdb_id     = null;
  let year        = item.year;

  // TMDB fallback when data is missing
  const needsTmdb = !poster || !description || genres.length === 0;
  if (needsTmdb && TMDB_API_KEY) {
    const tmdb = await fetchTMDB(item.title, item.year);
    if (tmdb) {
      if (!poster && tmdb.poster)         poster = tmdb.poster;
      if (!background && tmdb.background) background = tmdb.background;
      if (!description && tmdb.description) description = tmdb.description;
      if (!genres.length && tmdb.genres.length) genres = tmdb.genres;
      if (!director && tmdb.director)     director = tmdb.director;
      if (!cast.length && tmdb.cast.length) cast = tmdb.cast;
      if (!imdbRating && tmdb.imdbRating) imdbRating = parseFloat(tmdb.imdbRating);
      if (!runtime && tmdb.runtime)       runtime = tmdb.runtime;
      if (tmdb.imdb_id)                   imdb_id = tmdb.imdb_id;
      if (!year && tmdb.year)             year = tmdb.year;
    }
  }

  // Generate description from available data
  if (!description) {
    const parts = [];
    if (imdbRating) parts.push(`⭐ IMDB ${imdbRating}`);
    if (year)       parts.push(`📅 ${year}`);
    if (runtime)    parts.push(`⏱ ${runtime}`);
    if (genres.length) parts.push(`🎭 ${genres.join(", ")}`);
    if (director)   parts.push(`🎬 Director: ${director}`);
    if (item.writers) parts.push(`✍️ Writers: ${item.writers}`);
    if (cast.length) parts.push(`🌟 ${cast.join(", ")}`);
    description = parts.join("\n") || item.rawName || item.title;
  }

  const meta = {
    id:   item.id,
    type: item.type === "series" ? "series" : "movie",
    name: item.title,
  };

  if (poster)       meta.poster = poster;
  if (background)   meta.background = background;
  else if (poster)  meta.background = poster;
  if (description)  meta.description = description;
  if (year)         meta.year = year;
  if (genres.length)       meta.genres = genres;
  if (runtime)      meta.runtime = runtime;
  if (imdbRating)   meta.imdbRating = imdbRating;
  if (director)     meta.director = [director];
  if (cast.length)  meta.cast = cast;

  if (full) {
    meta.behaviorHints = { defaultVideoId: item.id };
    if (imdb_id) meta.imdb_id = imdb_id;
  }

  return meta;
}

// ═════════════════════════════════════════════════════════════
//  MANIFEST & HELPERS
// ═════════════════════════════════════════════════════════════

function collectGenres(items) {
  const s = new Set();
  for (const it of items) {
    if (it.genre) it.genre.forEach(g => s.add(g));
    if (it.language) s.add(it.language);
  }
  return [...s].sort();
}

function groupIdToKey(catalogId) {
  for (const g of groupTitles) {
    if (catalogId === `m3u_${g.replace(/[^a-zA-Z0-9]/g, "_")}`) return g;
  }
  return null;
}

function buildManifest() {
  const catalogs = [];

  // "All Movies" catalog
  if (allItems.length > 0) {
    catalogs.push({
      type: "movie",
      id: "m3u_all",
      name: "📺 All Movies",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre",  isRequired: false, options: collectGenres(allItems) },
        { name: "skip",   isRequired: false },
      ],
    });
  }

  // One catalog per group-title
  for (const g of groupTitles) {
    catalogs.push({
      type: "movie",
      id: `m3u_${g.replace(/[^a-zA-Z0-9]/g, "_")}`,
      name: g,
      extra: [
        { name: "search", isRequired: false },
        { name: "genre",  isRequired: false, options: collectGenres(catalogMap[g] || []) },
        { name: "skip",   isRequired: false },
      ],
    });
  }

  return {
    id:          "community.m3u.stremio.addon",
    version:     "2.0.0",
    name:        "M3U Stremio Addon",
    description: `Stream ${allItems.length} movies from M3U playlists with TMDB metadata, sort & filter`,
    logo:        "https://img.icons8.com/color/512/popcorn-time.png",
    resources:   ["catalog", "meta", "stream"],
    types:       ["movie"],
    catalogs,
    behaviorHints: { adult: false, configurable: false, configurationRequired: false },
    idPrefixes:  ["m3u_"],
  };
}

// ═════════════════════════════════════════════════════════════
//  EXPRESS APP
// ═════════════════════════════════════════════════════════════

const app = express();
app.use(cors());

function getBaseUrl(req) {
  if (RENDER_URL) return RENDER_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

// ── Landing page ─────────────────────────────────────────────
app.get("/", (req, res) => {
  const base = getBaseUrl(req);
  const manifestUrl = `${base}/manifest.json`;
  const stremioUrl  = `stremio://${manifestUrl.replace(/^https?:\/\//, "")}`;

  const groupHtml = groupTitles.map(g =>
    `<span style="display:inline-block;background:#1a1a2e;padding:6px 14px;border-radius:20px;font-size:12px;border:1px solid #333;margin:3px">${g} (${(catalogMap[g]||[]).length})</span>`
  ).join("");

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>M3U Stremio Addon</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a1a;color:#e0e0e0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
.c{max-width:600px;text-align:center}
h1{font-size:2.2rem;margin-bottom:.5rem;background:linear-gradient(135deg,#7b5ea7,#4a90d9);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.d{color:#888;margin-bottom:2rem;font-size:.95rem}
.stats{display:flex;gap:1rem;justify-content:center;margin-bottom:2rem;flex-wrap:wrap}
.st{background:#1a1a2e;padding:10px 18px;border-radius:10px;border:1px solid #333}
.st strong{color:#7b5ea7;font-size:1.2rem}
.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7b5ea7,#4a90d9);color:#fff;text-decoration:none;border-radius:12px;font-size:1.1rem;font-weight:600;margin-bottom:1rem;transition:transform .15s}
.btn:hover{transform:scale(1.05)}
.url{background:#1a1a2e;padding:10px 16px;border-radius:8px;word-break:break-all;font-size:13px;color:#4a90d9;border:1px solid #333;margin-bottom:2rem;cursor:pointer}
.gr{text-align:left;margin-top:1.5rem}
.gr h3{margin-bottom:8px;font-size:.95rem;color:#999}
.rf{margin-top:1.5rem;font-size:12px;color:#555}
</style>
</head>
<body>
<div class="c">
<h1>🎬 M3U Stremio Addon</h1>
<p class="d">Stream movies from M3U playlists with TMDB metadata &amp; smart catalogs</p>
<div class="stats">
  <div class="st"><strong>${allItems.length}</strong><br><small style="color:#888">Movies</small></div>
  <div class="st"><strong>${groupTitles.length}</strong><br><small style="color:#888">Categories</small></div>
  <div class="st"><strong>${TMDB_API_KEY ? "✅" : "❌"}</strong><br><small style="color:#888">TMDB</small></div>
  <div class="st"><strong>${REFRESH_HOURS}h</strong><br><small style="color:#888">Refresh</small></div>
</div>
<a href="${stremioUrl}" class="btn">📥 Install in Stremio</a>
<div class="url" onclick="navigator.clipboard.writeText('${manifestUrl}')" title="Click to copy">${manifestUrl}</div>
${groupTitles.length ? `<div class="gr"><h3>📂 Catalogs</h3><div>${groupHtml}</div></div>` : ""}
<p class="rf">Last refresh: ${lastRefresh ? lastRefresh.toISOString() : "Pending..."} &bull; Auto-refreshes every ${REFRESH_HOURS}h &bull; Keep-alive: ${RENDER_URL ? "Active ✅" : "Inactive"}</p>
</div>
</body>
</html>`);
});

// ── Manifest ─────────────────────────────────────────────────
app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(buildManifest());
});

// ── Catalog ──────────────────────────────────────────────────
app.get("/catalog/:type/:id/:extra?.json", async (req, res) => {
  try {
    const { id } = req.params;
    const extraStr = req.params.extra || "";

    // Parse extra params
    const extras = {};
    if (extraStr) {
      decodeURIComponent(extraStr).split("&").forEach(p => {
        const eq = p.indexOf("=");
        if (eq !== -1) extras[p.slice(0, eq)] = p.slice(eq + 1);
      });
    }

    const search = (extras.search || "").toLowerCase();
    const genre  = extras.genre || "";
    const skip   = parseInt(extras.skip, 10) || 0;
    const limit  = 100;

    // Get items
    let items;
    if (id === "m3u_all") {
      items = [...allItems];
    } else {
      const groupKey = groupIdToKey(id);
      items = groupKey ? [...(catalogMap[groupKey] || [])] : [];
    }

    // Search filter
    if (search) {
      items = items.filter(i =>
        (i.title || "").toLowerCase().includes(search) ||
        (i.rawName || "").toLowerCase().includes(search) ||
        (i.director || "").toLowerCase().includes(search) ||
        (i.stars || []).some(s => s.toLowerCase().includes(search))
      );
    }

    // Genre filter
    if (genre) {
      items = items.filter(i =>
        (i.genre || []).includes(genre) ||
        i.language === genre
      );
    }

    // Sort
    items.sort((a, b) => {
      if (a.year && b.year && a.year !== b.year) return b.year - a.year;
      if (a.imdbRating && b.imdbRating && a.imdbRating !== b.imdbRating) return b.imdbRating - a.imdbRating;
      return (a.title || "").localeCompare(b.title || "");
    });

    // Paginate
    const page = items.slice(skip, skip + limit);

    // Build metas in batches (avoid TMDB rate limits)
    const metas = [];
    const BATCH = 5;
    for (let i = 0; i < page.length; i += BATCH) {
      const batch = page.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(it => toStremiOMeta(it, false)));
      metas.push(...results);
    }

    res.json({ metas });
  } catch (err) {
    console.error("[CATALOG] Error:", err.message);
    res.json({ metas: [] });
  }
});

// ── Meta ─────────────────────────────────────────────────────
app.get("/meta/:type/:id.json", async (req, res) => {
  try {
    const item = allItems.find(i => i.id === req.params.id);
    if (!item) return res.json({ meta: null });
    const meta = await toStremiOMeta(item, true);
    res.json({ meta });
  } catch (err) {
    console.error("[META] Error:", err.message);
    res.json({ meta: null });
  }
});

// ── Stream ───────────────────────────────────────────────────
app.get("/stream/:type/:id.json", (req, res) => {
  try {
    const item = allItems.find(i => i.id === req.params.id);
    if (!item || !item.streamUrl) return res.json({ streams: [] });

    res.json({
      streams: [{
        title: `▶️ ${item.title}${item.duration ? ` (${item.duration})` : ""}${item.group ? `\n📂 ${item.group}` : ""}`,
        url: item.streamUrl,
        behaviorHints: {
          notWebReady: false,
          bingeGroup: item.group || "default",
        },
      }],
    });
  } catch (err) {
    console.error("[STREAM] Error:", err.message);
    res.json({ streams: [] });
  }
});

// ── Health ───────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    items: allItems.length,
    groups: groupTitles.length,
    catalogs: groupTitles,
    lastRefresh: lastRefresh ? lastRefresh.toISOString() : null,
    tmdb: !!TMDB_API_KEY,
    uptime: Math.floor(process.uptime()),
    keepAlive: !!RENDER_URL,
  });
});

// ═════════════════════════════════════════════════════════════
//  KEEP-ALIVE PINGER (Render free tier)
// ═════════════════════════════════════════════════════════════

function startKeepAlive() {
  if (!RENDER_URL) {
    console.log("[KEEP-ALIVE] ⚠ RENDER_EXTERNAL_URL not set — keep-alive disabled.");
    console.log("[KEEP-ALIVE] Set it to your Render URL to prevent free-tier spindown.");
    return;
  }

  const pingUrl = `${RENDER_URL}/health`;
  console.log(`[KEEP-ALIVE] ✅ Pinging ${pingUrl} every ${KEEP_ALIVE_MS / 60000} minutes`);

  setInterval(async () => {
    try {
      const { data } = await axios.get(pingUrl, { timeout: 15000 });
      console.log(`[KEEP-ALIVE] ✅ Ping OK — ${data.items} items, uptime ${data.uptime}s`);
    } catch (err) {
      console.error("[KEEP-ALIVE] ❌ Ping failed:", err.message);
    }
  }, KEEP_ALIVE_MS);
}

// ═════════════════════════════════════════════════════════════
//  STARTUP
// ═════════════════════════════════════════════════════════════

async function start() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  🎬 Stremio M3U Addon Server v2.0       ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  M3U:    ${M3U_URL ? "✅ Configured" : "❌ NOT SET"}`);
  console.log(`║  TMDB:   ${TMDB_API_KEY ? "✅ Configured" : "❌ Not configured (optional)"}`);
  console.log(`║  PORT:   ${PORT}`);
  console.log(`║  Render: ${RENDER_URL || "N/A"}`);
  console.log(`║  Refresh: Every ${REFRESH_HOURS} hours`);
  console.log("╚══════════════════════════════════════════╝");

  // Initial M3U fetch
  await refreshM3U();

  // Start Express
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`   Manifest:  http://localhost:${PORT}/manifest.json`);
    console.log(`   Health:    http://localhost:${PORT}/health`);
    console.log(`   Landing:   http://localhost:${PORT}/\n`);

    // Start background tasks
    setInterval(refreshM3U, REFRESH_MS);
    startKeepAlive();
  });
}

start().catch(err => {
  console.error("💥 Fatal startup error:", err);
  process.exit(1);
});
