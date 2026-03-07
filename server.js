// ============================================================
//  Stremio M3U Addon Server v3.0 — User-Configurable
//  ─────────────────────────────────────────────────────────
//  Config is encoded in the URL path (base64 JSON).
//  Users set M3U URL + optional TMDB key from the landing page.
//  URL format: /{base64config}/manifest.json
// ============================================================

const express = require("express");
const cors    = require("cors");
const axios   = require("axios");
const path    = require("path");

// ── ENV (server-level defaults / keep-alive) ─────────────────
const PORT          = parseInt(process.env.PORT, 10) || 7000;
const RENDER_URL    = process.env.RENDER_EXTERNAL_URL || "";
const DEFAULT_TMDB  = process.env.TMDB_API_KEY || "";
const REFRESH_HOURS = parseInt(process.env.REFRESH_HOURS, 10) || 6;
const REFRESH_MS    = REFRESH_HOURS * 3600000;
const KEEP_ALIVE_MS = 10 * 60000;

// ── PER-SOURCE CACHE ─────────────────────────────────────────
// key = m3uUrl → { items, catalogMap, groupTitles, lastRefresh }
const sourceCache = {};
const tmdbCache   = {};

// ═════════════════════════════════════════════════════════════
//  CONFIG HELPERS — encode/decode from URL
// ═════════════════════════════════════════════════════════════

function encodeConfig(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function decodeConfig(str) {
  try {
    const json = Buffer.from(str, "base64url").toString("utf-8");
    return JSON.parse(json);
  } catch {
    try {
      const json = Buffer.from(str, "base64").toString("utf-8");
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
}

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
  const getAttr = (key) => {
    const m = line.match(new RegExp(key + '="([^"]*)"', "i"));
    return m ? m[1].trim() : "";
  };

  const type      = getAttr("type") || "movie";
  const tvgLogo   = getAttr("tvg-logo");
  const groupLogo = getAttr("group-logo");
  const group     = getAttr("group-title");

  const ci = line.lastIndexOf(",");
  const rawName = ci !== -1 ? line.substring(ci + 1).trim() : "";

  return { type, tvgLogo, groupLogo, group, rawName, ...parseDisplayName(rawName) };
}

function parseDisplayName(name) {
  const d = {
    title: name, year: null, genre: [], duration: null,
    director: null, writers: null, stars: [], imdbRating: null, language: null,
  };
  if (!name) return d;

  // IMDB rating (handles bold unicode and plain)
  const imdbM = name.match(/[I\u{1D5DC}][M\u{1D5E0}][D\u{1D5D7}][B\u{1D5D5}]\s*([\d.]+)/iu);
  if (imdbM) d.imdbRating = parseFloat(imdbM[1]);

  // Year
  const years = [...name.matchAll(/\b((?:19|20)\d{2})\b/g)];
  if (years.length) d.year = parseInt(years[0][1], 10);

  // Title: text before first "("
  const tM = name.match(/^([^(]*?)(?:\s*\(|$)/);
  if (tM && tM[1].trim()) d.title = tM[1].trim();

  // Genres from ‧-delimited section
  const gM = name.match(/‧\s*([\w\s\\/|]+(?:\s*[\w\s\\/|]+)*)\s*‧/);
  if (gM) {
    d.genre = gM[1].split(/[\\/|]/).map(g => g.trim()).filter(Boolean);
    const langs = ["Hindi","Tamil","Telugu","Malayalam","Kannada","Bengali","English","Korean","Japanese","Marathi","Punjabi","Gujarati","Urdu","Chinese","Spanish","French","German","Italian","Portuguese","Arabic","Turkish","Thai","Vietnamese","Indonesian","Malay","Filipino"];
    const last = d.genre[d.genre.length - 1];
    if (last && langs.some(l => l.toLowerCase() === last.toLowerCase())) d.language = last;
  }

  // Duration
  const durM = name.match(/(\d+h\s*\d*m?)/i);
  if (durM) d.duration = durM[1];

  // Director
  const dirM = name.match(/Directors?\s+([^|)]+)/i);
  if (dirM) d.director = dirM[1].trim().replace(/\s+/g, " ");

  // Writers
  const wriM = name.match(/Writers?\s+([^|)]+)/i);
  if (wriM) d.writers = wriM[1].trim().replace(/\s+/g, " ");

  // Stars
  const staM = name.match(/Stars?\s+(.+?)(?:\)|$)/i);
  if (staM) d.stars = staM[1].split("‧").map(s => s.trim()).filter(Boolean);

  return d;
}

function makeId(item) {
  const slug = `${item.title}__${item.year || "0"}`
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `m3u_${slug}`;
}

// ═════════════════════════════════════════════════════════════
//  TMDB FALLBACK
// ═════════════════════════════════════════════════════════════

async function fetchTMDB(title, year, tmdbKey) {
  if (!tmdbKey) return null;
  const cacheKey = `${title}|${year || ""}`;
  if (cacheKey in tmdbCache) return tmdbCache[cacheKey];

  try {
    const q = encodeURIComponent(title);
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${q}`;
    if (year) url += `&year=${year}`;

    let { data } = await axios.get(url, { timeout: 8000 });
    if ((!data.results || !data.results.length) && year) {
      const r2 = await axios.get(
        `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${q}`,
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
      `https://api.themoviedb.org/3/movie/${movieId}?api_key=${tmdbKey}&append_to_response=credits,external_ids`,
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
    console.error("[TMDB] Error:", title, err.message);
    tmdbCache[cacheKey] = null;
    return null;
  }
}

// ═════════════════════════════════════════════════════════════
//  FETCH & CACHE M3U PER SOURCE
// ═════════════════════════════════════════════════════════════

async function getSource(m3uUrl) {
  const now = Date.now();
  const cached = sourceCache[m3uUrl];

  if (cached && (now - cached.ts) < REFRESH_MS) {
    return cached;
  }

  console.log(`[M3U] Fetching: ${m3uUrl.substring(0, 80)}...`);
  try {
    const { data } = await axios.get(m3uUrl, {
      timeout: 60000,
      responseType: "text",
      headers: { "User-Agent": "StremioM3UAddon/3.0" },
    });

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
        if (a.imdbRating && b.imdbRating && a.imdbRating !== b.imdbRating) return b.imdbRating - a.imdbRating;
        return (a.title || "").localeCompare(b.title || "");
      });
    }

    const groupTitles = Object.keys(catalogMap).sort();
    const result = { items, catalogMap, groupTitles, ts: now, lastRefresh: new Date().toISOString() };
    sourceCache[m3uUrl] = result;

    console.log(`[M3U] ✅ ${items.length} items in ${groupTitles.length} groups`);
    return result;
  } catch (err) {
    console.error("[M3U] ❌ Fetch error:", err.message);
    if (cached) return cached; // return stale if available
    return { items: [], catalogMap: {}, groupTitles: [], ts: now, lastRefresh: null };
  }
}

// ═════════════════════════════════════════════════════════════
//  BUILD STREMIO META
// ═════════════════════════════════════════════════════════════

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
    if (imdbRating) parts.push(`⭐ IMDB ${imdbRating}`);
    if (year) parts.push(`📅 ${year}`);
    if (runtime) parts.push(`⏱ ${runtime}`);
    if (genres.length) parts.push(`🎭 ${genres.join(", ")}`);
    if (director) parts.push(`🎬 Director: ${director}`);
    if (item.writers) parts.push(`✍️ Writers: ${item.writers}`);
    if (cast.length) parts.push(`🌟 ${cast.join(", ")}`);
    description = parts.join("\n") || item.rawName || item.title;
  }

  const meta = {
    id: item.id,
    type: item.type === "series" ? "series" : "movie",
    name: item.title,
  };

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

// ═════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════

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

function buildManifest(source, configStr) {
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
      type: "movie",
      id: `m3u_${g.replace(/[^a-zA-Z0-9]/g, "_")}`,
      name: g,
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: collectGenres(catalogMap[g] || []) },
        { name: "skip", isRequired: false },
      ],
    });
  }

  return {
    id: "community.m3u.stremio.addon",
    version: "3.0.0",
    name: "M3U Stremio Addon",
    description: `Stream ${items.length} titles from M3U playlists with smart catalogs, sort & filter`,
    logo: "https://img.icons8.com/color/512/popcorn-time.png",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    catalogs,
    behaviorHints: {
      adult: false,
      configurable: true,
      configurationRequired: true,
    },
    idPrefixes: ["m3u_"],
  };
}

// ═════════════════════════════════════════════════════════════
//  EXPRESS APP
// ═════════════════════════════════════════════════════════════

const app = express();
app.use(cors());
app.use(express.json());

function getBaseUrl(req) {
  if (RENDER_URL) return RENDER_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

// ── Serve static configure page (built React app) ────────────
app.use("/configure", express.static(path.join(__dirname, "configure")));

// ── Root → redirect to /configure ────────────────────────────
app.get("/", (req, res) => {
  res.redirect("/configure");
});

// ── API: Validate M3U URL ────────────────────────────────────
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

// ── API: Generate config ─────────────────────────────────────
app.post("/api/config", (req, res) => {
  const { m3uUrl, tmdbKey } = req.body;
  if (!m3uUrl) return res.json({ ok: false, error: "M3U URL is required" });

  const config = { m3uUrl };
  if (tmdbKey) config.tmdbKey = tmdbKey;

  const encoded = encodeConfig(config);
  const base = getBaseUrl(req);

  res.json({
    ok: true,
    configId: encoded,
    manifestUrl: `${base}/${encoded}/manifest.json`,
    stremioUrl: `stremio://${base.replace(/^https?:\/\//, "")}/${encoded}/manifest.json`,
  });
});

// ── Manifest ─────────────────────────────────────────────────
app.get("/:config/manifest.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) {
    return res.status(400).json({ error: "Invalid config. Go to /configure to set up." });
  }

  try {
    const source = await getSource(cfg.m3uUrl);
    const manifest = buildManifest(source, req.params.config);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catalog ──────────────────────────────────────────────────
app.get("/:config/catalog/:type/:id/:extra?.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ metas: [] });

  try {
    const source = await getSource(cfg.m3uUrl);
    const tmdbKey = cfg.tmdbKey || DEFAULT_TMDB;
    const { id } = req.params;
    const extraStr = req.params.extra || "";

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

// ── Meta ─────────────────────────────────────────────────────
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

// ── Stream ───────────────────────────────────────────────────
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

// ── Health ───────────────────────────────────────────────────
app.get("/health", (req, res) => {
  const sources = Object.keys(sourceCache).length;
  const totalItems = Object.values(sourceCache).reduce((s, c) => s + c.items.length, 0);
  res.json({
    status: "ok",
    sources,
    totalItems,
    tmdbCacheSize: Object.keys(tmdbCache).length,
    uptime: Math.floor(process.uptime()),
    keepAlive: !!RENDER_URL,
  });
});

// ═════════════════════════════════════════════════════════════
//  KEEP-ALIVE
// ═════════════════════════════════════════════════════════════

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
      console.log(`[KEEP-ALIVE] ✅ OK — ${data.totalItems} items cached, uptime ${data.uptime}s`);
    } catch (err) {
      console.error("[KEEP-ALIVE] ❌", err.message);
    }
  }, KEEP_ALIVE_MS);
}

// ── Periodic cache cleanup (remove sources not accessed in 24h) ──
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600000;
  for (const url of Object.keys(sourceCache)) {
    if (sourceCache[url].ts < cutoff) {
      console.log(`[CACHE] Evicting stale source: ${url.substring(0, 60)}...`);
      delete sourceCache[url];
    }
  }
}, 3600000);

// ═════════════════════════════════════════════════════════════
//  STARTUP
// ═════════════════════════════════════════════════════════════

app.listen(PORT, "0.0.0.0", () => {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  🎬 Stremio M3U Addon Server v3.0            ║");
  console.log("║  User-configurable — no env M3U_URL needed   ║");
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
