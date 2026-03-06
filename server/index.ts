// ─── Stremio Addon Server ─────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadState, getState, updateConfig, fetchAndRefresh,
  startAutoRefresh, saveState, getGenres, getYears, getLanguages,
} from './store.js';
import addonRouter from './addon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '7000', 10);
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── Load persisted state ─────────────────────────────────────────────────────
loadState();

// ─── Stremio Addon Endpoints ──────────────────────────────────────────────────
app.use('/', addonRouter);

// ─── Admin API ────────────────────────────────────────────────────────────────

// GET /api/status
app.get('/api/status', (_req, res) => {
  const { entries, lastFetched, config } = getState();
  res.json({
    ok: true,
    total: entries.length,
    lastFetched,
    config: {
      addonName:           config.addonName,
      addonId:             config.addonId,
      m3uUrl:              config.m3uUrl,
      filterGroups:        config.filterGroups,
      refreshIntervalHours: config.refreshIntervalHours,
      tmdbConfigured:      !!config.tmdbApiKey,
    },
    addonUrl: `${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}/manifest.json`,
  });
});

// GET /api/filters — unique genres, years, languages
app.get('/api/filters', (_req, res) => {
  res.json({
    genres:    getGenres(),
    years:     getYears(),
    languages: getLanguages(),
  });
});

// GET /api/entries — paginated + filterable movie list
app.get('/api/entries', (req, res) => {
  const { entries } = getState();
  const skip     = parseInt(req.query.skip     as string || '0',  10);
  const limit    = parseInt(req.query.limit    as string || '50', 10);
  const search   = req.query.search   as string | undefined;
  const genre    = req.query.genre    as string | undefined;
  const year     = req.query.year     as string | undefined;
  const language = req.query.language as string | undefined;

  let filtered = entries;

  if (genre) {
    const g = genre.toLowerCase();
    filtered = filtered.filter(e => e.genre?.toLowerCase().includes(g));
  }
  if (year) {
    filtered = filtered.filter(e => e.year === year);
  }
  if (language) {
    const l = language.toLowerCase();
    filtered = filtered.filter(e => e.language?.toLowerCase() === l);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(e =>
      e.cleanTitle.toLowerCase().includes(q) ||
      e.stars?.toLowerCase().includes(q) ||
      e.director?.toLowerCase().includes(q) ||
      e.genre?.toLowerCase().includes(q) ||
      e.year?.includes(q)
    );
  }

  res.json({
    total:   filtered.length,
    skip,
    limit,
    entries: filtered.slice(skip, skip + limit),
  });
});

// POST /api/config
app.post('/api/config', (req, res) => {
  updateConfig(req.body);
  res.json({ ok: true, config: getState().config });
});

// POST /api/refresh
app.post('/api/refresh', async (_req, res) => {
  try {
    const result = await fetchAndRefresh();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// POST /api/refresh/full — re-enrich all with TMDB
app.post('/api/refresh/full', async (_req, res) => {
  try {
    const result = await fetchAndRefresh(true);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// DELETE /api/entries/:id
app.delete('/api/entries/:id', (req, res) => {
  const { id } = req.params;
  const state = getState();
  state.entries = state.entries.filter(e => e.id !== id);
  saveState();
  res.json({ ok: true });
});

// ─── Serve React UI (built dist) ──────────────────────────────────────────────
const DIST = path.join(__dirname, '..', 'dist');
app.use('/ui', express.static(DIST));
app.get('/ui/*', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

// ─── Keep-Alive Ping (free tier) ──────────────────────────────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(async () => {
  try {
    await fetch(`${SELF_URL}/api/status`);
    console.log('[KeepAlive] Ping OK');
  } catch { /* ignore */ }
}, 14 * 60 * 1000);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const { config } = getState();
  console.log(`
╔══════════════════════════════════════════════════════╗
║       VT Stremio Addon Server Started                ║
╠══════════════════════════════════════════════════════╣
║  Addon URL : http://localhost:${PORT}/manifest.json
║  Admin UI  : http://localhost:${PORT}/ui
║  Status    : http://localhost:${PORT}/api/status
║  Filters   : http://localhost:${PORT}/api/filters
║  TMDB Key  : ${config.tmdbApiKey ? '✅ Configured' : '⚠️  Not set (set TMDB_API_KEY env)'}
║  M3U URL   : ${config.m3uUrl || '⚠️  Not set (set via /api/config)'}
╚══════════════════════════════════════════════════════╝
  `);

  startAutoRefresh();

  if (config.m3uUrl) {
    console.log('[Server] Starting initial M3U fetch...');
    fetchAndRefresh().catch(e => console.error('[Server] Initial fetch failed:', e.message));
  }
});

export default app;
