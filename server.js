const express = require("express");
const cors = require("cors");
const axios = require("axios");

const PORT = parseInt(process.env.PORT, 10) || 7000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "";
const DEFAULT_TMDB = process.env.TMDB_API_KEY || "";
const REFRESH_HOURS = parseInt(process.env.REFRESH_HOURS, 10) || 6;
const REFRESH_MS = REFRESH_HOURS * 3600000;
const KEEP_ALIVE_MS = 10 * 60000;

const sourceCache = {};
const tmdbCache = {};

// ── Config encode/decode ────────────────────────────────
function encodeConfig(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function decodeConfig(str) {
  try {
    return JSON.parse(Buffer.from(str, "base64url").toString("utf-8"));
  } catch (e) {
    try { return JSON.parse(Buffer.from(str, "base64").toString("utf-8")); }
    catch (e2) { return null; }
  }
}

// ══════════════════════════════════════════════════════════
//  BULLETPROOF M3U PARSER
// ══════════════════════════════════════════════════════════

function parseM3U(raw) {
  var lines = raw.split(/\r?\n/);
  var items = [];
  var curExtInf = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();

    if (trimmed.startsWith("#EXTINF:")) {
      curExtInf = trimmed;
    } else if (curExtInf !== null) {
      if (/^https?:\/\//i.test(trimmed)) {
        var item = parseExtInf(curExtInf);
        if (item) {
          item.streamUrl = trimmed;
          item.id = makeId(item);
          items.push(item);
        }
        curExtInf = null;
      } else if (trimmed === "" || trimmed.startsWith("#EXTM3U") || trimmed.startsWith("#EXTVLCOPT")) {
        // skip
      } else if (trimmed.startsWith("#EXTINF:")) {
        curExtInf = trimmed;
      } else if (trimmed.startsWith("#")) {
        // skip other comments
      } else {
        curExtInf = curExtInf + " " + trimmed;
      }
    }
  }

  return items;
}

function parseExtInf(line) {
  var attrs = {};
  var attrRegex = /([\w-]+)="([^"]*)"/g;
  var m;
  while ((m = attrRegex.exec(line)) !== null) {
    attrs[m[1].toLowerCase()] = m[2].trim();
  }

  var tvgLogo = attrs["tvg-logo"] || "";
  var groupLogo = attrs["group-logo"] || "";
  var poster = tvgLogo || groupLogo || "";
  var group = attrs["group-title"] || "";
  var type = attrs["type"] || "movie";

  // Strict parsing: only accept items from "VT 🎬 | Tamil Movies" group
  if (group !== "VT 🎬 | Tamil Movies") return null;

  var rawName = "";
  var lastQuoteIdx = -1;
  var inQuote = false;
  for (var i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuote = !inQuote;
      if (!inQuote) lastQuoteIdx = i;
    }
  }
  if (lastQuoteIdx > -1) {
    var commaIdx = line.indexOf(",", lastQuoteIdx);
    if (commaIdx !== -1) {
      rawName = line.substring(commaIdx + 1).trim();
    }
  } else {
    var ci = line.lastIndexOf(",");
    if (ci !== -1) rawName = line.substring(ci + 1).trim();
  }

  var parsed = parseDisplayName(rawName);
  return {
    type: type, poster: poster, group: group, rawName: rawName,
    title: parsed.title, year: parsed.year, genre: parsed.genre,
    duration: parsed.duration, director: parsed.director,
    writers: parsed.writers, stars: parsed.stars,
    imdbRating: parsed.imdbRating, language: parsed.language
  };
}

function parseDisplayName(name) {
  var result = {
    title: name || "Unknown", year: null, genre: [], duration: null,
    director: null, writers: null, stars: [], imdbRating: null, language: null
  };
  if (!name) return result;

  var cleanName = name.replace(/^#+\s*/, "");

  var imdbMatch = name.match(/(?:IMDB|𝗜𝗠𝗗𝗕)\s*([\d.]+)/i);
  if (imdbMatch) result.imdbRating = parseFloat(imdbMatch[1]);

  var yearMatches = [];
  var yearRegex = /\b((?:19|20)\d{2})\b/g;
  var ym;
  while ((ym = yearRegex.exec(name)) !== null) {
    yearMatches.push(parseInt(ym[1], 10));
  }
  var movieYears = yearMatches.filter(function(y) { return y >= 1920 && y <= 2030; });
  if (movieYears.length > 0) result.year = movieYears[0];

  var titleMatch = name.match(/^([^(]+?)(?:\s*\(|$)/);
  if (titleMatch && titleMatch[1].trim()) {
    var t = titleMatch[1].trim().replace(/^#+\s*/, "");
    if (t) result.title = t;
  } else {
    result.title = cleanName || name;
  }

  var genreMatch = name.match(/‧\s*([A-Za-z][A-Za-z\s\\/|,]+[A-Za-z])\s*‧/);
  if (genreMatch) {
    var genreStr = genreMatch[1];
    var genres = genreStr.split(/[\\/|,]/).map(function(g) { return g.trim(); }).filter(Boolean);
    var knownLangs = ["Hindi","Tamil","Telugu","Malayalam","Kannada","Bengali","English","Korean","Japanese","Marathi","Punjabi","Gujarati","Urdu","Chinese","Spanish","French","German","Italian","Portuguese","Arabic","Turkish","Thai","Vietnamese","Indonesian","Malay","Filipino"];
    var filteredGenres = [];
    for (var i = 0; i < genres.length; i++) {
      var isLang = knownLangs.some(function(l) { return l.toLowerCase() === genres[i].toLowerCase(); });
      if (isLang) {
        result.language = genres[i];
      } else {
        filteredGenres.push(genres[i]);
      }
    }
    result.genre = filteredGenres.length > 0 ? filteredGenres : genres;
  }

  var durMatch = name.match(/(\d+h\s*\d*m?)/i);
  if (durMatch) result.duration = durMatch[1].trim();

  var dirMatch = name.match(/Directors?\s+([^|)]+)/i);
  if (dirMatch) {
    result.director = dirMatch[1].trim().replace(/\s+/g, " ").replace(/\s*(Writers?|Stars?).*$/i, "").trim();
  }

  var wriMatch = name.match(/Writers?\s+([^|)]+)/i);
  if (wriMatch) {
    result.writers = wriMatch[1].trim().replace(/\s+/g, " ").replace(/\s*(Stars?).*$/i, "").trim();
  }

  var starsMatch = name.match(/Stars?\s+(.+?)(?:\)|$)/i);
  if (starsMatch) {
    result.stars = starsMatch[1].split("‧").map(function(s) { return s.trim(); }).filter(Boolean);
    if (result.stars.length > 0) {
      var last = result.stars[result.stars.length - 1];
      result.stars[result.stars.length - 1] = last.replace(/\)\s*$/, "").trim();
    }
    result.stars = result.stars.filter(Boolean);
  }

  return result;
}

function makeId(item) {
  var slug = (item.title + "__" + (item.year || "0"))
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return "m3u_" + slug;
}

// ── TMDB Fallback ───────────────────────────────────────
async function fetchTMDB(title, year, tmdbKey) {
  if (!tmdbKey) return null;
  var ck = title + "|" + (year || "");
  if (ck in tmdbCache) return tmdbCache[ck];
  try {
    var q = encodeURIComponent(title);
    var url = "https://api.themoviedb.org/3/search/movie?api_key=" + tmdbKey + "&query=" + q;
    if (year) url += "&year=" + year;
    var resp = await axios.get(url, { timeout: 8000 });
    var data = resp.data;
    if ((!data.results || !data.results.length) && year) {
      var r2 = await axios.get("https://api.themoviedb.org/3/search/movie?api_key=" + tmdbKey + "&query=" + q, { timeout: 8000 });
      data = r2.data;
    }
    if (!data.results || !data.results.length) { tmdbCache[ck] = null; return null; }
    var mid = data.results[0].id;
    var detResp = await axios.get(
      "https://api.themoviedb.org/3/movie/" + mid + "?api_key=" + tmdbKey + "&append_to_response=credits,external_ids",
      { timeout: 8000 }
    );
    var det = detResp.data;
    var result = {
      poster: det.poster_path ? "https://image.tmdb.org/t/p/w500" + det.poster_path : null,
      background: det.backdrop_path ? "https://image.tmdb.org/t/p/w1280" + det.backdrop_path : null,
      description: det.overview || null,
      imdbRating: det.vote_average ? det.vote_average.toFixed(1) : null,
      year: det.release_date ? new Date(det.release_date).getFullYear() : null,
      genres: det.genres ? det.genres.map(function(g) { return g.name; }) : [],
      runtime: det.runtime ? Math.floor(det.runtime / 60) + "h " + (det.runtime % 60) + "m" : null,
      director: det.credits && det.credits.crew ? (det.credits.crew.find(function(c) { return c.job === "Director"; }) || {}).name || null : null,
      cast: det.credits && det.credits.cast ? det.credits.cast.slice(0, 5).map(function(c) { return c.name; }) : [],
      imdb_id: det.imdb_id || (det.external_ids && det.external_ids.imdb_id) || null,
    };
    tmdbCache[ck] = result;
    return result;
  } catch (err) {
    console.error("[TMDB]", title, err.message);
    tmdbCache[ck] = null;
    return null;
  }
}

// ── Fetch & Cache M3U ───────────────────────────────────
async function getSource(m3uUrl) {
  var now = Date.now();
  var cached = sourceCache[m3uUrl];
  if (cached && (now - cached.ts) < REFRESH_MS) return cached;
  console.log("[M3U] Fetching:", m3uUrl.substring(0, 80));
  try {
    var resp = await axios.get(m3uUrl, {
      timeout: 60000, responseType: "text",
      headers: { "User-Agent": "StremioM3UAddon/3.0" }
    });
    var rawText = typeof resp.data === "string" ? resp.data : String(resp.data);
    console.log("[M3U] Raw length:", rawText.length, "chars");
    var items = parseM3U(rawText);
    console.log("[M3U] Parsed", items.length, "items");

    var catalogMap = {};
    for (var i = 0; i < items.length; i++) {
      var g = items[i].group || "Uncategorized";
      if (!catalogMap[g]) catalogMap[g] = [];
      catalogMap[g].push(items[i]);
    }
    for (var g2 of Object.keys(catalogMap)) {
      catalogMap[g2].sort(function(a, b) {
        if (a.year && b.year && a.year !== b.year) return b.year - a.year;
        if (a.imdbRating && b.imdbRating) return b.imdbRating - a.imdbRating;
        return (a.title || "").localeCompare(b.title || "");
      });
    }
    var groupTitles = Object.keys(catalogMap).sort();
    var result = { items: items, catalogMap: catalogMap, groupTitles: groupTitles, ts: now };
    sourceCache[m3uUrl] = result;
    console.log("[M3U]", items.length, "items in", groupTitles.length, "groups:", groupTitles.join(", "));
    return result;
  } catch (err) {
    console.error("[M3U] Fetch error:", err.message);
    if (cached) return cached;
    return { items: [], catalogMap: {}, groupTitles: [], ts: now };
  }
}

// ── Filter source by selected groups ────────────────────
function filterSource(source, selectedGroups) {
  if (!selectedGroups || !selectedGroups.length) return source;
  var filteredMap = {};
  var filteredItems = [];
  var filteredTitles = [];
  for (var i = 0; i < selectedGroups.length; i++) {
    var g = selectedGroups[i];
    if (source.catalogMap[g]) {
      filteredMap[g] = source.catalogMap[g];
      filteredItems = filteredItems.concat(source.catalogMap[g]);
      filteredTitles.push(g);
    }
  }
  filteredTitles.sort();
  return {
    items: filteredItems,
    catalogMap: filteredMap,
    groupTitles: filteredTitles,
    ts: source.ts
  };
}

// ── Build Stremio Meta ──────────────────────────────────
async function toMeta(item, tmdbKey, full) {
  var poster = item.poster || null;
  var background = null;
  var description = null;
  var genres = item.genre && item.genre.length ? item.genre.slice() : [];
  var director = item.director;
  var cast = item.stars && item.stars.length ? item.stars.slice() : [];
  var imdbRating = item.imdbRating;
  var runtime = item.duration;
  var imdb_id = null;
  var year = item.year;

  var needsTmdb = !poster || !description || genres.length === 0;
  if (needsTmdb && tmdbKey) {
    var tmdb = await fetchTMDB(item.title, item.year, tmdbKey);
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
    var parts = [];
    if (imdbRating) parts.push("IMDB " + imdbRating);
    if (year) parts.push("Year: " + year);
    if (runtime) parts.push("Duration: " + runtime);
    if (genres.length) parts.push("Genres: " + genres.join(", "));
    if (director) parts.push("Director: " + director);
    if (item.writers) parts.push("Writers: " + item.writers);
    if (cast.length) parts.push("Stars: " + cast.join(", "));
    description = parts.join("\n") || item.rawName || item.title;
  }

  var meta = { id: item.id, type: item.type === "series" ? "series" : "movie", name: item.title };
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

// ── Helpers ─────────────────────────────────────────────
function collectGenres(items) {
  var s = new Set();
  for (var i = 0; i < items.length; i++) {
    if (items[i].genre) items[i].genre.forEach(function(g) { s.add(g); });
    if (items[i].language) s.add(items[i].language);
  }
  return Array.from(s).sort();
}

function groupIdToKey(catalogId, groupTitles) {
  for (var i = 0; i < groupTitles.length; i++) {
    if (catalogId === "m3u_" + groupTitles[i].replace(/[^a-zA-Z0-9]/g, "_")) return groupTitles[i];
  }
  return null;
}

function buildManifest(source) {
  var items = source.items;
  var catalogMap = source.catalogMap;
  var groupTitles = source.groupTitles;
  var catalogs = [];
  if (items.length > 0) {
    catalogs.push({
      type: "movie", id: "m3u_all", name: "All Movies (" + items.length + ")",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: collectGenres(items) },
        { name: "skip", isRequired: false },
      ],
    });
  }
  for (var i = 0; i < groupTitles.length; i++) {
    var g = groupTitles[i];
    var count = (catalogMap[g] || []).length;
    catalogs.push({
      type: "movie",
      id: "m3u_" + g.replace(/[^a-zA-Z0-9]/g, "_"),
      name: g + " (" + count + ")",
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
    description: "Stream " + items.length + " titles from M3U playlists with smart catalogs, sort & filter",
    logo: "https://img.icons8.com/color/512/popcorn-time.png",
    resources: ["catalog", "meta", "stream"], types: ["movie"],
    catalogs: catalogs,
    behaviorHints: { adult: false, configurable: true, configurationRequired: false },
    idPrefixes: ["m3u_"],
  };
}

// ── Express App ─────────────────────────────────────────
var app = express();
app.use(cors());
app.use(express.json());

function getBaseUrl(req) {
  if (RENDER_URL) return RENDER_URL;
  var proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return proto + "://" + req.get("host");
}

app.get("/", function(req, res) {
  res.setHeader("Content-Type", "text/html");
  res.send(getConfigureHTML());
});

app.get("/configure", function(req, res) {
  res.setHeader("Content-Type", "text/html");
  res.send(getConfigureHTML());
});

// ── API: Validate (scan M3U) ────────────────────────────
app.post("/api/validate", async function(req, res) {
  var m3uUrl = (req.body && req.body.m3uUrl) || "";
  if (!m3uUrl) return res.json({ ok: false, error: "No URL provided" });
  try {
    var source = await getSource(m3uUrl);
    var groupCounts = source.groupTitles.map(function(g) {
      return { name: g, count: (source.catalogMap[g] || []).length };
    });
    var groupSamples = {};
    for (var i = 0; i < source.groupTitles.length; i++) {
      var g = source.groupTitles[i];
      var grpItems = source.catalogMap[g] || [];
      groupSamples[g] = grpItems.slice(0, 5).map(function(it) {
        return {
          title: it.title, year: it.year, rating: it.imdbRating,
          poster: it.poster, genres: it.genre, duration: it.duration,
          director: it.director, stars: it.stars
        };
      });
    }
    var allGenres = collectGenres(source.items);
    var withPoster = source.items.filter(function(it) { return !!it.poster; }).length;
    var rated = source.items.filter(function(it) { return it.imdbRating; });
    var avgRating = rated.length ? (rated.reduce(function(s, it) { return s + it.imdbRating; }, 0) / rated.length).toFixed(1) : null;
    var years = source.items.map(function(it) { return it.year; }).filter(Boolean);
    var minYear = years.length ? Math.min.apply(null, years) : null;
    var maxYear = years.length ? Math.max.apply(null, years) : null;

    res.json({
      ok: true, totalItems: source.items.length,
      groups: source.groupTitles, groupCounts: groupCounts,
      groupSamples: groupSamples, allGenres: allGenres,
      withPoster: withPoster, avgRating: avgRating,
      minYear: minYear, maxYear: maxYear
    });
  } catch (err) {
    console.error("[VALIDATE]", err);
    res.json({ ok: false, error: err.message });
  }
});

// ── API: Generate config ────────────────────────────────
app.post("/api/config", function(req, res) {
  var m3uUrl = (req.body && req.body.m3uUrl) || "";
  var tmdbKey = (req.body && req.body.tmdbKey) || "";
  var groups = (req.body && req.body.groups) || [];
  if (!m3uUrl) return res.json({ ok: false, error: "M3U URL is required" });
  var config = { m3uUrl: m3uUrl };
  if (tmdbKey) config.tmdbKey = tmdbKey;
  if (groups && groups.length > 0) config.groups = groups;
  var encoded = encodeConfig(config);
  var base = getBaseUrl(req);
  res.json({
    ok: true, configId: encoded,
    manifestUrl: base + "/" + encoded + "/manifest.json",
    stremioUrl: "stremio://" + base.replace(/^https?:\/\//, "") + "/" + encoded + "/manifest.json"
  });
});

// ── Stremio: Manifest ───────────────────────────────────
app.get("/:config/manifest.json", async function(req, res) {
  var cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.status(400).json({ error: "Invalid config" });
  try {
    var source = await getSource(cfg.m3uUrl);
    source = filterSource(source, cfg.groups);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(buildManifest(source));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Stremio: Catalog ────────────────────────────────────
app.get("/:config/catalog/:type/:id/:extra?.json", async function(req, res) {
  var cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ metas: [] });
  try {
    var source = await getSource(cfg.m3uUrl);
    source = filterSource(source, cfg.groups);
    var tmdbKey = cfg.tmdbKey || DEFAULT_TMDB;
    var id = req.params.id;
    var extras = {};
    var extraStr = req.params.extra || "";
    if (extraStr) {
      decodeURIComponent(extraStr).split("&").forEach(function(p) {
        var eq = p.indexOf("=");
        if (eq !== -1) extras[p.slice(0, eq)] = p.slice(eq + 1);
      });
    }
    var search = (extras.search || "").toLowerCase();
    var genre = extras.genre || "";
    var skip = parseInt(extras.skip, 10) || 0;
    var limit = 100;

    var items;
    if (id === "m3u_all") {
      items = source.items.slice();
    } else {
      var groupKey = groupIdToKey(id, source.groupTitles);
      items = groupKey ? (source.catalogMap[groupKey] || []).slice() : [];
    }

    if (search) {
      items = items.filter(function(it) {
        return (it.title || "").toLowerCase().includes(search) ||
          (it.rawName || "").toLowerCase().includes(search) ||
          (it.director || "").toLowerCase().includes(search) ||
          (it.stars || []).some(function(s) { return s.toLowerCase().includes(search); });
      });
    }
    if (genre) {
      items = items.filter(function(it) {
        return (it.genre || []).includes(genre) || it.language === genre;
      });
    }

    items.sort(function(a, b) {
      if (a.year && b.year && a.year !== b.year) return b.year - a.year;
      if (a.imdbRating && b.imdbRating && a.imdbRating !== b.imdbRating) return b.imdbRating - a.imdbRating;
      return (a.title || "").localeCompare(b.title || "");
    });

    var page = items.slice(skip, skip + limit);
    var metas = [];
    for (var i = 0; i < page.length; i += 5) {
      var batch = page.slice(i, i + 5);
      var results = await Promise.all(batch.map(function(it) { return toMeta(it, tmdbKey, false); }));
      metas = metas.concat(results);
    }
    res.json({ metas: metas });
  } catch (err) {
    console.error("[CATALOG]", err.message);
    res.json({ metas: [] });
  }
});

// ── Stremio: Meta ───────────────────────────────────────
app.get("/:config/meta/:type/:id.json", async function(req, res) {
  var cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ meta: null });
  try {
    var source = await getSource(cfg.m3uUrl);
    var tmdbKey = cfg.tmdbKey || DEFAULT_TMDB;
    var item = source.items.find(function(it) { return it.id === req.params.id; });
    if (!item) return res.json({ meta: null });
    var meta = await toMeta(item, tmdbKey, true);
    res.json({ meta: meta });
  } catch (err) {
    console.error("[META]", err.message);
    res.json({ meta: null });
  }
});

// ── Stremio: Stream ─────────────────────────────────────
app.get("/:config/stream/:type/:id.json", async function(req, res) {
  var cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ streams: [] });
  try {
    var source = await getSource(cfg.m3uUrl);
    var item = source.items.find(function(it) { return it.id === req.params.id; });
    if (!item || !item.streamUrl) return res.json({ streams: [] });
    var streamTitle = item.title;
    if (item.duration) streamTitle += " (" + item.duration + ")";
    if (item.group) streamTitle += "\n" + item.group;
    res.json({
      streams: [{
        title: streamTitle, url: item.streamUrl,
        behaviorHints: { notWebReady: false, bingeGroup: item.group || "default" },
      }],
    });
  } catch (err) {
    console.error("[STREAM]", err.message);
    res.json({ streams: [] });
  }
});

// ── Health ──────────────────────────────────────────────
app.get("/health", function(req, res) {
  var sources = Object.keys(sourceCache).length;
  var totalItems = Object.values(sourceCache).reduce(function(s, c) { return s + c.items.length; }, 0);
  res.json({ status: "ok", sources: sources, totalItems: totalItems, tmdbCacheSize: Object.keys(tmdbCache).length, uptime: Math.floor(process.uptime()) });
});

// ── Keep-alive ──────────────────────────────────────────
function startKeepAlive() {
  if (!RENDER_URL) { console.log("[KEEP-ALIVE] RENDER_EXTERNAL_URL not set"); return; }
  var pingUrl = RENDER_URL + "/health";
  console.log("[KEEP-ALIVE] Pinging", pingUrl, "every", KEEP_ALIVE_MS / 60000, "min");
  setInterval(async function() {
    try {
      await axios.get(pingUrl, { timeout: 15000 });
      console.log("[KEEP-ALIVE] OK @", new Date().toISOString());
    } catch (err) {
      console.error("[KEEP-ALIVE]", err.message);
    }
  }, KEEP_ALIVE_MS);
}

setInterval(function() {
  var cutoff = Date.now() - 24 * 3600000;
  for (var url of Object.keys(sourceCache)) {
    if (sourceCache[url].ts < cutoff) {
      console.log("[CACHE] Evicting:", url.substring(0, 60));
      delete sourceCache[url];
    }
  }
}, 3600000);


// ══════════════════════════════════════════════════════════
//  CONFIGURE HTML — self-contained with group selection
// ══════════════════════════════════════════════════════════
function getConfigureHTML() {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>M3U Stremio Addon - Configure</title>',
    '<style>' + getCSS() + '</style>',
    '</head>',
    '<body>',
    '<div class="glow"></div>',
    '<div class="container">',
    getHeaderHTML(),
    getStepsHTML(),
    getFormHTML(),
    '<div id="results"></div>',
    '</div>',
    '<script>' + getScript() + '</script>',
    '</body>',
    '</html>'
  ].join('\n');
}

function getCSS() {
  return [
    '*{margin:0;padding:0;box-sizing:border-box}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a1a;color:#e0e0e0;min-height:100vh}',
    '.glow{position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:800px;height:800px;border-radius:50%;background:rgba(139,92,246,0.04);filter:blur(120px);pointer-events:none}',
    '.container{max-width:720px;margin:0 auto;padding:2rem 1rem;position:relative;z-index:1}',
    '.header{text-align:center;margin-bottom:2.5rem}',
    '.header h1{font-size:2rem;font-weight:800;background:linear-gradient(135deg,#a78bfa,#60a5fa,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}',
    '.header p{color:#666;font-size:.85rem;margin-top:.5rem}',
    '.card{background:#111127;border:1px solid #1e1e3a;border-radius:1rem;overflow:hidden;margin-bottom:1.5rem}',
    '.card-header{padding:1.25rem 1.5rem;background:linear-gradient(135deg,rgba(139,92,246,.08),rgba(59,130,246,.08));border-bottom:1px solid #1e1e3a}',
    '.card-header h2{font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:.5rem}',
    '.card-header p{color:#555;font-size:.8rem;margin-top:.25rem}',
    '.card-body{padding:1.5rem}',
    'label{display:block;font-size:.85rem;font-weight:600;color:#bbb;margin-bottom:.5rem}',
    'label .req{color:#f87171}',
    '.input-row{display:flex;gap:.5rem}',
    'input[type="url"],input[type="text"]{flex:1;padding:.75rem 1rem;background:#0a0a1a;border:1px solid #2a2a4a;border-radius:.75rem;color:#e0e0e0;font-size:.85rem;outline:none;transition:border .2s}',
    'input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.15)}',
    'input::placeholder{color:#444}',
    '.btn{padding:.75rem 1.5rem;border:none;border-radius:.75rem;font-weight:700;font-size:.85rem;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:.5rem}',
    '.btn-scan{background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:#fff;box-shadow:0 4px 20px rgba(139,92,246,.2);white-space:nowrap}',
    '.btn-scan:hover{box-shadow:0 4px 30px rgba(139,92,246,.4);transform:translateY(-1px)}',
    '.btn-scan:disabled{background:#333;color:#666;box-shadow:none;cursor:not-allowed;transform:none}',
    '.btn-gen{background:linear-gradient(135deg,#f59e0b,#f97316);color:#fff;box-shadow:0 4px 20px rgba(245,158,11,.2);font-size:1.1rem;padding:1rem 2.5rem;white-space:nowrap}',
    '.btn-gen:hover{box-shadow:0 4px 30px rgba(245,158,11,.4);transform:translateY(-1px)}',
    '.btn-gen:disabled{background:#333;color:#666;box-shadow:none;cursor:not-allowed;transform:none}',
    '.btn-install{display:flex;align-items:center;justify-content:center;gap:.5rem;background:linear-gradient(135deg,#22c55e,#10b981);color:#fff;box-shadow:0 4px 20px rgba(34,197,94,.2);font-size:1.1rem;padding:1rem;width:100%;border-radius:.75rem;font-weight:700;text-decoration:none;border:none;cursor:pointer;transition:all .2s}',
    '.btn-install:hover{box-shadow:0 4px 30px rgba(34,197,94,.4);transform:translateY(-1px)}',
    '.btn-copy{background:rgba(139,92,246,.08);color:#a78bfa;border:1px solid rgba(139,92,246,.2);padding:.5rem 1rem;font-size:.75rem;cursor:pointer;border-radius:.5rem;font-weight:600}',
    '.btn-copy:hover{background:rgba(139,92,246,.15)}',
    '.spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '.tmdb-toggle{font-size:.8rem;color:#888;cursor:pointer;display:flex;align-items:center;gap:.5rem;margin-top:1rem;background:none;border:none;font-weight:600}',
    '.tmdb-toggle:hover{color:#bbb}',
    '.hint{font-size:.72rem;color:#555;margin-top:.3rem}',
    '.hint a{color:#60a5fa;text-decoration:none}',
    '.hidden{display:none}',
    '.steps{display:flex;align-items:center;justify-content:center;gap:.5rem;margin-bottom:2rem;flex-wrap:wrap;font-size:.8rem}',
    '.step{padding:.4rem .8rem;border-radius:.5rem;border:1px solid #1e1e3a;background:#111127;color:#555;transition:all .3s}',
    '.step.active{background:rgba(139,92,246,0.12);border-color:rgba(139,92,246,0.3);color:#a78bfa}',
    '.step.done{background:rgba(34,197,94,0.12);border-color:rgba(34,197,94,0.3);color:#4ade80}',
    '.step-arrow{color:#333}',
    '.hero-count{text-align:center;padding:2rem;background:linear-gradient(135deg,rgba(139,92,246,.08),#111127,rgba(59,130,246,.08));border:1px solid rgba(139,92,246,.15);border-radius:1rem;margin-bottom:1rem}',
    '.hero-count .num{font-size:4rem;font-weight:900;background:linear-gradient(135deg,#a78bfa,#60a5fa,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}',
    '.hero-count .lbl{color:#888;font-size:1.1rem;margin-top:.35rem;font-weight:600}',
    '.hero-count .sub{color:#555;font-size:.85rem;margin-top:.15rem}',
    '.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:.75rem;margin-bottom:1rem}',
    '.stat-card{background:#0a0a1a;padding:1rem;border-radius:.75rem;border:1px solid #1e1e3a;text-align:center}',
    '.stat-card .val{font-size:1.4rem;font-weight:800}',
    '.stat-card .lbl{font-size:.65rem;color:#555;margin-top:.15rem}',
    '.text-blue{color:#60a5fa}.text-green{color:#4ade80}.text-yellow{color:#facc15}.text-purple{color:#a78bfa}.text-orange{color:#fb923c}',
    '.group-item{border-bottom:1px solid #1e1e3a;overflow:hidden}',
    '.group-item:last-child{border-bottom:none}',
    '.group-header{display:flex;align-items:center;gap:.5rem;padding:.75rem 1.25rem;transition:background .15s}',
    '.group-header:hover{background:#16162e}',
    '.group-cb{width:18px;height:18px;accent-color:#8b5cf6;cursor:pointer;flex-shrink:0}',
    '.group-toggle{flex:1;display:flex;align-items:center;justify-content:space-between;background:none;border:none;color:#e0e0e0;cursor:pointer;text-align:left;font-size:.85rem;padding:0}',
    '.group-name{font-weight:600;display:flex;align-items:center;gap:.5rem}',
    '.group-count{background:rgba(139,92,246,.15);color:#a78bfa;padding:.2rem .6rem;border-radius:2rem;font-size:.8rem;font-weight:700}',
    '.group-detail{padding:0 1.25rem 1rem;display:none}',
    '.group-detail.open{display:block}',
    '.sample-item{display:flex;align-items:center;gap:.5rem;padding:.35rem 0;font-size:.75rem}',
    '.sample-poster{width:28px;height:40px;object-fit:cover;border-radius:.25rem;background:#1e1e3a;flex-shrink:0}',
    '.sample-title{color:#ccc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sample-year{color:#555;font-size:.7rem}',
    '.sample-rating{color:#facc15;font-size:.7rem}',
    '.genre-pill{display:inline-block;padding:.15rem .4rem;background:#0a0a1a;border:1px solid #1e1e3a;border-radius:.35rem;font-size:.6rem;color:#888;margin:.15rem .1rem}',
    '.select-bar{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1.25rem;background:rgba(139,92,246,.04);border-bottom:1px solid #1e1e3a;flex-wrap:wrap;gap:.5rem}',
    '.select-bar .sel-info{font-size:.85rem;font-weight:700;color:#a78bfa}',
    '.select-bar .sel-actions{display:flex;gap:.5rem}',
    '.sel-btn{background:rgba(139,92,246,.1);color:#a78bfa;border:1px solid rgba(139,92,246,.2);padding:.3rem .6rem;font-size:.7rem;cursor:pointer;border-radius:.35rem;font-weight:600}',
    '.sel-btn:hover{background:rgba(139,92,246,.2)}',
    '.addon-card{border-color:rgba(34,197,94,.2)}',
    '.addon-card .card-header{background:linear-gradient(135deg,rgba(34,197,94,.08),rgba(16,185,129,.08));border-bottom-color:rgba(34,197,94,.2)}',
    '.url-box{display:flex;align-items:center;gap:.5rem;background:#0a0a1a;padding:.75rem 1rem;border-radius:.75rem;border:1px solid #2a2a4a;margin-bottom:1rem}',
    '.url-box code{flex:1;font-size:.7rem;color:#60a5fa;word-break:break-all;font-family:monospace}',
    '.alert{padding:1rem 1.25rem;border-radius:.75rem;font-size:.8rem;margin-bottom:1rem;display:flex;align-items:flex-start;gap:.75rem}',
    '.alert-error{background:rgba(248,113,113,.04);border:1px solid rgba(248,113,113,.15);color:#f87171}',
    '.alert-warn{background:rgba(250,204,21,.04);border:1px solid rgba(250,204,21,.15);color:#facc15}',
    '.alert-text{color:#aaa;font-size:.78rem;line-height:1.5}',
    '.info-box{background:rgba(139,92,246,.04);border:1px solid rgba(139,92,246,.15);border-radius:.75rem;padding:1rem;margin-top:1rem}',
    '.info-box h4{color:#a78bfa;font-size:.85rem;margin-bottom:.35rem}',
    '.info-box p{color:#666;font-size:.75rem;line-height:1.5}',
    '.selected-summary{text-align:center;padding:1rem;margin:1rem 0;background:rgba(139,92,246,.04);border:1px solid rgba(139,92,246,.12);border-radius:.75rem}',
    '.selected-summary .sel-num{font-size:2.5rem;font-weight:900;background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}',
    '.selected-summary .sel-lbl{color:#888;font-size:.85rem;margin-top:.25rem}',
    '@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
    '.fade-in{animation:fadeIn .4s ease}',
    '@keyframes countUp{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}',
    '.count-up{animation:countUp .6s cubic-bezier(0.34,1.56,0.64,1)}',
  ].join('\n');
}

function getHeaderHTML() {
  return [
    '<div class="header">',
    '  <div style="font-size:3rem;margin-bottom:.5rem">&#127916;</div>',
    '  <h1>M3U Stremio Addon</h1>',
    '  <p>v3.0 &middot; Enter M3U URL &rarr; Select catalogs &rarr; Install in Stremio</p>',
    '</div>'
  ].join('\n');
}

function getStepsHTML() {
  return [
    '<div class="steps">',
    '  <span class="step active" id="step1">&#9312; Enter URL</span>',
    '  <span class="step-arrow">&rarr;</span>',
    '  <span class="step" id="step2">&#9313; Select Groups</span>',
    '  <span class="step-arrow">&rarr;</span>',
    '  <span class="step" id="step3">&#9314; Get Link</span>',
    '  <span class="step-arrow">&rarr;</span>',
    '  <span class="step" id="step4">&#9315; Install</span>',
    '</div>'
  ].join('\n');
}

function getFormHTML() {
  return [
    '<div class="card">',
    '  <div class="card-header">',
    '    <h2>&#9881;&#65039; Configure Your Source</h2>',
    '    <p>Paste your raw M3U URL, scan it, then select which catalogs you want</p>',
    '  </div>',
    '  <div class="card-body">',
    '    <label>M3U Playlist URL <span class="req">*</span></label>',
    '    <div class="input-row">',
    '      <input type="url" id="m3uUrl" placeholder="https://raw.githubusercontent.com/user/repo/main/playlist.m3u" />',
    '      <button class="btn btn-scan" id="scanBtn" disabled>&#128270; Scan</button>',
    '    </div>',
    '    <p class="hint">Raw GitHub URL to your .m3u file. Must be publicly accessible.</p>',
    '    <button class="tmdb-toggle" id="tmdbToggle" type="button">',
    '      &#127916; TMDB API Key <span style="background:rgba(34,197,94,.1);color:#4ade80;padding:.1rem .4rem;border-radius:.35rem;font-size:.6rem;border:1px solid rgba(34,197,94,.15)">Optional</span> &#9660;',
    '    </button>',
    '    <div id="tmdbSection" class="hidden" style="margin-top:.75rem">',
    '      <input type="text" id="tmdbKey" placeholder="your-tmdb-api-key-here" style="font-family:monospace" />',
    '      <p class="hint">Auto-fetches missing posters &amp; metadata. <a href="https://www.themoviedb.org/settings/api" target="_blank">Get free key &rarr;</a></p>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

function getScript() {
  return [
    '(function() {',
    '  var m3uInput = document.getElementById("m3uUrl");',
    '  var scanBtn = document.getElementById("scanBtn");',
    '  var resultsDiv = document.getElementById("results");',
    '  var tmdbToggle = document.getElementById("tmdbToggle");',
    '  var tmdbSection = document.getElementById("tmdbSection");',
    '  var scanData = null;',
    '  var selectedGroups = new Set();',
    '',
    '  tmdbToggle.addEventListener("click", function() {',
    '    tmdbSection.classList.toggle("hidden");',
    '  });',
    '',
    '  m3uInput.addEventListener("input", function() {',
    '    scanBtn.disabled = !m3uInput.value.trim();',
    '    setStep(1);',
    '    resultsDiv.innerHTML = "";',
    '    scanData = null;',
    '    selectedGroups.clear();',
    '  });',
    '',
    '  scanBtn.addEventListener("click", doScan);',
    '  m3uInput.addEventListener("keydown", function(e) {',
    '    if (e.key === "Enter" && m3uInput.value.trim()) doScan();',
    '  });',
    '',
    '  function setStep(n) {',
    '    for (var i = 1; i <= 4; i++) {',
    '      var el = document.getElementById("step" + i);',
    '      el.classList.remove("active", "done");',
    '      if (i < n) el.classList.add("done");',
    '      else if (i === n) el.classList.add("active");',
    '    }',
    '  }',
    '',
    '  function esc(s) {',
    '    if (!s) return "";',
    '    var d = document.createElement("div");',
    '    d.textContent = String(s);',
    '    return d.innerHTML;',
    '  }',
    '',
    '  async function doScan() {',
    '    var url = m3uInput.value.trim();',
    '    if (!url) return;',
    '    scanBtn.disabled = true;',
    '    scanBtn.innerHTML = \'<span class="spinner"></span> Scanning...\';',
    '    resultsDiv.innerHTML = \'<div style="text-align:center;padding:3rem;color:#666"><span class="spinner" style="border-color:rgba(139,92,246,.3);border-top-color:#a78bfa;width:36px;height:36px"></span><p style="margin-top:1rem;font-size:.85rem">Fetching and parsing M3U source...</p></div>\';',
    '',
    '    try {',
    '      var resp = await fetch("/api/validate", {',
    '        method: "POST",',
    '        headers: { "Content-Type": "application/json" },',
    '        body: JSON.stringify({ m3uUrl: url })',
    '      });',
    '      var data = await resp.json();',
    '',
    '      if (!data.ok) {',
    '        resultsDiv.innerHTML = \'<div class="alert alert-error fade-in"><span style="font-size:1.2rem">&#10060;</span><div class="alert-text">\' + esc(data.error) + \'</div></div>\';',
    '        resetScan();',
    '        return;',
    '      }',
    '',
    '      if (data.totalItems === 0) {',
    '        resultsDiv.innerHTML = \'<div class="alert alert-error fade-in"><span style="font-size:1.2rem">&#10060;</span><div class="alert-text">No movies found in this M3U file.</div></div>\';',
    '        resetScan();',
    '        return;',
    '      }',
    '',
    '      scanData = data;',
    '      selectedGroups.clear();',
    '      var gc = data.groupCounts || [];',
    '      for (var i = 0; i < gc.length; i++) {',
    '        selectedGroups.add(gc[i].name);',
    '      }',
    '      setStep(2);',
    '      renderResults();',
    '    } catch (err) {',
    '      resultsDiv.innerHTML = \'<div class="alert alert-error fade-in"><span style="font-size:1.2rem">&#10060;</span><div class="alert-text">Network error: \' + esc(err.message) + \'</div></div>\';',
    '    }',
    '    resetScan();',
    '  }',
    '',
    '  function resetScan() {',
    '    scanBtn.disabled = false;',
    '    scanBtn.innerHTML = "&#128270; Scan";',
    '  }',
    '',
    '  function getSelectedCount() {',
    '    var gc = scanData.groupCounts || [];',
    '    var total = 0;',
    '    for (var i = 0; i < gc.length; i++) {',
    '      if (selectedGroups.has(gc[i].name)) total += gc[i].count;',
    '    }',
    '    return total;',
    '  }',
    '',
    '  function renderResults() {',
    '    if (!scanData) return;',
    '    var data = scanData;',
    '    var total = data.totalItems || 0;',
    '    var groups = data.groupCounts || [];',
    '    var samples = data.groupSamples || {};',
    '    var selCount = getSelectedCount();',
    '    var h = "";',
    '',
    '    h += \'<div class="hero-count fade-in count-up">\';',
    '    h += \'<div class="num">\' + total.toLocaleString() + \'</div>\';',
    '    h += \'<div class="lbl">Total Movies Found</div>\';',
    '    h += \'<div class="sub">\' + groups.length + " catalog" + (groups.length !== 1 ? "s" : "") + \' detected in this M3U file</div>\';',
    '    h += \'</div>\';',
    '',
    '    h += \'<div class="stats-row fade-in">\';',
    '    h += sc("&#128194;", groups.length, "Catalogs", "text-blue");',
    '    h += sc("&#127916;", total, "Total", "text-purple");',
    '    h += sc("&#128247;", data.withPoster || 0, "With Poster", "text-green");',
    '    if (data.avgRating) h += sc("&#11088;", data.avgRating, "Avg Rating", "text-yellow");',
    '    if (data.minYear && data.maxYear) h += sc("&#128197;", data.minYear + "-" + data.maxYear, "Year Range", "text-orange");',
    '    h += \'</div>\';',
    '',
    '    if (groups.length > 0) {',
    '      h += \'<div class="card fade-in">\';',
    '      h += \'<div class="card-header"><h2>&#9745;&#65039; Select Catalogs</h2><p>Choose which group-titles to include in your Stremio addon</p></div>\';',
    '      h += \'<div class="select-bar">\';',
    '      h += \'<span class="sel-info" id="selInfo">\' + selectedGroups.size + \' of \' + groups.length + \' selected (\' + selCount.toLocaleString() + \' movies)</span>\';',
    '      h += \'<span class="sel-actions">\';',
    '      h += \'<button class="sel-btn" data-action="all">Select All</button>\';',
    '      h += \'<button class="sel-btn" data-action="none">Select None</button>\';',
    '      h += \'</span></div>\';',
    '      h += \'<div style="max-height:600px;overflow-y:auto">\';',
    '      for (var g = 0; g < groups.length; g++) {',
    '        var grp = groups[g];',
    '        var gid = "grp_" + g;',
    '        var checked = selectedGroups.has(grp.name) ? " checked" : "";',
    '        var samps = samples[grp.name] || [];',
    '        h += \'<div class="group-item">\';',
    '        h += \'<div class="group-header">\';',
    '        h += \'<input type="checkbox" class="group-cb" data-group="\' + esc(grp.name) + \'" id="cb_\' + g + \'"\' + checked + \' />\';',
    '        h += \'<button class="group-toggle" data-toggle="\' + gid + \'">\';',
    '        h += \'<span class="group-name">&#128193; \' + esc(grp.name) + \'</span>\';',
    '        h += \'<span class="group-count">\' + grp.count + \' movies</span>\';',
    '        h += \'</button>\';',
    '        h += \'</div>\';',
    '        h += \'<div class="group-detail" id="\' + gid + \'">\';',
    '        if (samps.length > 0) {',
    '          h += \'<div style="font-size:.7rem;color:#555;margin-bottom:.5rem">Sample movies:</div>\';',
    '          for (var s = 0; s < samps.length; s++) {',
    '            var sm = samps[s];',
    '            h += \'<div class="sample-item">\';',
    '            if (sm.poster) {',
    '              h += \'<img class="sample-poster" src="\' + esc(sm.poster) + \'" alt="" loading="lazy" onerror="this.style.display=\\\'none\\\'" />\';',
    '            } else {',
    '              h += \'<div class="sample-poster" style="display:flex;align-items:center;justify-content:center;font-size:.5rem;color:#555">&#127916;</div>\';',
    '            }',
    '            h += \'<span class="sample-title">\' + esc(sm.title) + \'</span>\';',
    '            if (sm.year) h += \'<span class="sample-year">\' + sm.year + \'</span>\';',
    '            if (sm.rating) h += \'<span class="sample-rating">&#11088; \' + sm.rating + \'</span>\';',
    '            h += \'</div>\';',
    '          }',
    '        }',
    '        h += \'</div></div>\';',
    '      }',
    '      h += \'</div></div>\';',
    '    }',
    '',
    '    h += \'<div class="selected-summary fade-in" id="selSummary">\';',
    '    h += \'<div class="sel-num" id="selCountNum">\' + selCount.toLocaleString() + \'</div>\';',
    '    h += \'<div class="sel-lbl">Movies in \' + selectedGroups.size + \' selected catalog\' + (selectedGroups.size !== 1 ? "s" : "") + \'</div>\';',
    '    h += \'</div>\';',
    '',
    '    h += \'<div style="text-align:center;margin:1.5rem 0" class="fade-in">\';',
    '    h += \'<button class="btn btn-gen" id="generateBtn"\' + (selectedGroups.size === 0 ? " disabled" : "") + \'>&#128640; Generate Addon URL</button>\';',
    '    h += \'<p class="hint" style="margin-top:.5rem">Only your selected catalogs will appear in Stremio</p>\';',
    '    h += \'</div>\';',
    '',
    '    h += \'<div id="addonResult"></div>\';',
    '',
    '    resultsDiv.innerHTML = h;',
    '',
    '    // Attach toggle listeners',
    '    var toggleBtns = document.querySelectorAll("[data-toggle]");',
    '    for (var t = 0; t < toggleBtns.length; t++) {',
    '      toggleBtns[t].addEventListener("click", function() {',
    '        var tid = this.getAttribute("data-toggle");',
    '        var target = document.getElementById(tid);',
    '        if (target) target.classList.toggle("open");',
    '      });',
    '    }',
    '',
    '    // Attach checkbox listeners',
    '    var cbs = document.querySelectorAll(".group-cb");',
    '    for (var c = 0; c < cbs.length; c++) {',
    '      cbs[c].addEventListener("change", function() {',
    '        var gname = this.getAttribute("data-group");',
    '        if (this.checked) {',
    '          selectedGroups.add(gname);',
    '        } else {',
    '          selectedGroups.delete(gname);',
    '        }',
    '        updateSelectionUI();',
    '      });',
    '    }',
    '',
    '    // Select All / None',
    '    var selBtns = document.querySelectorAll("[data-action]");',
    '    for (var sb = 0; sb < selBtns.length; sb++) {',
    '      selBtns[sb].addEventListener("click", function() {',
    '        var action = this.getAttribute("data-action");',
    '        var allCbs = document.querySelectorAll(".group-cb");',
    '        if (action === "all") {',
    '          selectedGroups.clear();',
    '          var gc = scanData.groupCounts || [];',
    '          for (var i = 0; i < gc.length; i++) selectedGroups.add(gc[i].name);',
    '          for (var i = 0; i < allCbs.length; i++) allCbs[i].checked = true;',
    '        } else {',
    '          selectedGroups.clear();',
    '          for (var i = 0; i < allCbs.length; i++) allCbs[i].checked = false;',
    '        }',
    '        updateSelectionUI();',
    '      });',
    '    }',
    '',
    '    var genBtn = document.getElementById("generateBtn");',
    '    if (genBtn) genBtn.addEventListener("click", doGenerate);',
    '  }',
    '',
    '  function updateSelectionUI() {',
    '    var selCount = getSelectedCount();',
    '    var infoEl = document.getElementById("selInfo");',
    '    var groups = scanData.groupCounts || [];',
    '    if (infoEl) infoEl.textContent = selectedGroups.size + " of " + groups.length + " selected (" + selCount.toLocaleString() + " movies)";',
    '    var numEl = document.getElementById("selCountNum");',
    '    if (numEl) numEl.textContent = selCount.toLocaleString();',
    '    var summaryEl = document.getElementById("selSummary");',
    '    if (summaryEl) {',
    '      var lbl = summaryEl.querySelector(".sel-lbl");',
    '      if (lbl) lbl.textContent = "Movies in " + selectedGroups.size + " selected catalog" + (selectedGroups.size !== 1 ? "s" : "");',
    '    }',
    '    var genBtn = document.getElementById("generateBtn");',
    '    if (genBtn) genBtn.disabled = selectedGroups.size === 0;',
    '  }',
    '',
    '  function sc(icon, val, label, cls) {',
    '    return \'<div class="stat-card"><div style="font-size:1.2rem;margin-bottom:.25rem">\' + icon +',
    '      \'</div><div class="val \' + cls + \'">\' + val + \'</div><div class="lbl">\' + label + \'</div></div>\';',
    '  }',
    '',
    '  async function doGenerate() {',
    '    var m3uUrl = m3uInput.value.trim();',
    '    var tmdbKeyEl = document.getElementById("tmdbKey");',
    '    var tmdbKey = tmdbKeyEl ? tmdbKeyEl.value.trim() : "";',
    '    if (!m3uUrl || selectedGroups.size === 0) return;',
    '',
    '    var genBtn = document.getElementById("generateBtn");',
    '    if (genBtn) {',
    '      genBtn.disabled = true;',
    '      genBtn.innerHTML = \'<span class="spinner"></span> Generating...\';',
    '    }',
    '',
    '    try {',
    '      var body = { m3uUrl: m3uUrl, groups: Array.from(selectedGroups) };',
    '      if (tmdbKey) body.tmdbKey = tmdbKey;',
    '',
    '      var resp = await fetch("/api/config", {',
    '        method: "POST",',
    '        headers: { "Content-Type": "application/json" },',
    '        body: JSON.stringify(body)',
    '      });',
    '      var data = await resp.json();',
    '',
    '      if (!data.ok) {',
    '        document.getElementById("addonResult").innerHTML =',
    '          \'<div class="alert alert-error fade-in"><span>&#10060;</span><div class="alert-text">\' + esc(data.error) + \'</div></div>\';',
    '        resetGen();',
    '        return;',
    '      }',
    '',
    '      setStep(3);',
    '',
    '      var selCount = getSelectedCount();',
    '      var rh = \'<div class="card addon-card fade-in">\';',
    '      rh += \'<div class="card-header"><h2>&#127881; Your Addon is Ready!</h2><p>\' + selCount + \' movies from \' + selectedGroups.size + \' catalog\' + (selectedGroups.size !== 1 ? "s" : "") + \'</p></div>\';',
    '      rh += \'<div class="card-body">\';',
    '',
    '      rh += \'<label>Manifest URL</label>\';',
    '      rh += \'<div class="url-box"><code id="mUrlText">\' + esc(data.manifestUrl) + \'</code>\';',
    '      rh += \'<button class="btn-copy" id="copyBtn">&#128203; Copy</button></div>\';',
    '',
    '      rh += \'<a href="\' + esc(data.stremioUrl) + \'" class="btn-install" id="installLink">&#128229; Install in Stremio</a>\';',
    '',
    '      rh += \'<p style="text-align:center;font-size:.75rem;color:#555;margin-top:.75rem">Or paste the manifest URL in Stremio &rarr; Addons &rarr; Search bar</p>\';',
    '',
    '      rh += \'<div style="margin-top:1rem;padding:.75rem;background:rgba(139,92,246,.04);border:1px solid rgba(139,92,246,.1);border-radius:.5rem">\';',
    '      rh += \'<div style="font-size:.75rem;font-weight:700;color:#a78bfa;margin-bottom:.5rem">&#128194; Selected Catalogs:</div>\';',
    '      var arr = Array.from(selectedGroups);',
    '      for (var i = 0; i < arr.length; i++) {',
    '        var gc = scanData.groupCounts || [];',
    '        var cnt = 0;',
    '        for (var j = 0; j < gc.length; j++) { if (gc[j].name === arr[i]) cnt = gc[j].count; }',
    '        rh += \'<div style="font-size:.72rem;color:#888;padding:.2rem 0">&#9745; \' + esc(arr[i]) + \' <span style="color:#a78bfa">(\' + cnt + \')</span></div>\';',
    '      }',
    '      rh += \'</div>\';',
    '',
    '      rh += \'<div class="info-box"><h4>&#128161; Change source or catalogs anytime</h4>\';',
    '      rh += \'<p>Come back here, enter a new URL or select different catalogs, and generate a new addon URL. Each configuration gets a unique URL.</p></div>\';',
    '',
    '      rh += \'</div></div>\';',
    '',
    '      document.getElementById("addonResult").innerHTML = rh;',
    '',
    '      document.getElementById("copyBtn").addEventListener("click", function() {',
    '        var text = document.getElementById("mUrlText").textContent;',
    '        navigator.clipboard.writeText(text).then(function() {',
    '          document.getElementById("copyBtn").innerHTML = "&#9989; Copied!";',
    '          setTimeout(function() {',
    '            document.getElementById("copyBtn").innerHTML = "&#128203; Copy";',
    '          }, 2000);',
    '        });',
    '      });',
    '',
    '      document.getElementById("installLink").addEventListener("click", function() {',
    '        setStep(4);',
    '      });',
    '',
    '      document.getElementById("addonResult").scrollIntoView({ behavior: "smooth", block: "start" });',
    '',
    '    } catch (err) {',
    '      document.getElementById("addonResult").innerHTML =',
    '        \'<div class="alert alert-error fade-in"><span>&#10060;</span><div class="alert-text">Error: \' + esc(err.message) + \'</div></div>\';',
    '    }',
    '    resetGen();',
    '  }',
    '',
    '  function resetGen() {',
    '    var genBtn = document.getElementById("generateBtn");',
    '    if (genBtn) {',
    '      genBtn.disabled = selectedGroups.size === 0;',
    '      genBtn.innerHTML = "&#128640; Generate Addon URL";',
    '    }',
    '  }',
    '',
    '})();'
  ].join('\n');
}


// ── Start Server ────────────────────────────────────────
app.listen(PORT, "0.0.0.0", function() {
  console.log("============================================");
  console.log("  M3U Stremio Addon Server v3.0");
  console.log("  PORT:       " + PORT);
  console.log("  Render URL: " + (RENDER_URL || "N/A"));
  console.log("  TMDB key:   " + (DEFAULT_TMDB ? "YES" : "NO"));
  console.log("  Refresh:    Every " + REFRESH_HOURS + "h");
  console.log("============================================");
  console.log("  http://localhost:" + PORT);
  console.log("  http://localhost:" + PORT + "/configure");
  console.log("");
  startKeepAlive();
});
