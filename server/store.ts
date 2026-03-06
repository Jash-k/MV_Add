// ─── In-Memory Store with Persistence ────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { MovieEntry, parseM3U, mergeEntries } from './parser.js';
import { searchTmdbMovie, fetchTmdbByImdbId } from './tmdb.js';

const DATA_FILE = path.join(process.cwd(), '.addon-data.json');

export interface AddonConfig {
  m3uUrl: string;
  filterGroups: string[];
  tmdbApiKey: string;
  refreshIntervalHours: number;
  addonName: string;
  addonVersion: string;
  addonId: string;
  addonDescription: string;
}

export interface StoreState {
  entries: MovieEntry[];
  lastFetched: string | null;
  config: AddonConfig;
}

const DEFAULT_CONFIG: AddonConfig = {
  m3uUrl: process.env.M3U_URL || '',
  filterGroups: ['VT 🎬 | Tamil Movies'],
  tmdbApiKey: process.env.TMDB_API_KEY || '',
  refreshIntervalHours: 6,
  addonName: 'VT Tamil Movies',
  addonVersion: '1.0.0',
  addonId: 'com.vt.tamil.stremio',
  addonDescription: 'Tamil movies addon powered by VT collection with TMDB metadata',
};

// ─── State ────────────────────────────────────────────────────────────────────
let state: StoreState = {
  entries: [],
  lastFetched: null,
  config: { ...DEFAULT_CONFIG },
};

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Persist ──────────────────────────────────────────────────────────────────
export function saveState(): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

export function loadState(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const saved = JSON.parse(raw) as StoreState;
      state.entries = saved.entries || [];
      state.lastFetched = saved.lastFetched || null;
      state.config = {
        ...DEFAULT_CONFIG,
        ...saved.config,
        tmdbApiKey: process.env.TMDB_API_KEY || saved.config?.tmdbApiKey || '',
        m3uUrl: process.env.M3U_URL || saved.config?.m3uUrl || '',
      };
    }
  } catch { /* ignore */ }
}

export function getState(): StoreState { return state; }

export function updateConfig(updates: Partial<AddonConfig>): void {
  state.config = { ...state.config, ...updates };
  saveState();
}

// ─── CORS Proxy Fallbacks ─────────────────────────────────────────────────────
const PROXIES = [
  (u: string) => u,
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
];

async function fetchWithFallback(url: string): Promise<string> {
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(url), {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'StremioAddon/1.0' },
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes('#EXTINF') || text.includes('#EXTM3U')) return text;
    } catch { /* try next */ }
  }
  throw new Error('All fetch attempts failed for: ' + url);
}

// ─── TMDB Enrichment ──────────────────────────────────────────────────────────
async function enrichWithTmdb(entry: MovieEntry, apiKey: string): Promise<MovieEntry> {
  if (!apiKey || entry.tmdbFetched) return entry;

  try {
    let tmdbData = null;

    if (entry.imdbId) tmdbData = await fetchTmdbByImdbId(entry.imdbId, apiKey);
    if (!tmdbData)    tmdbData = await searchTmdbMovie(entry.cleanTitle, entry.year, apiKey);
    if (!tmdbData)    return { ...entry, tmdbFetched: true };

    return {
      ...entry,
      cleanTitle:  entry.cleanTitle  || tmdbData.title,
      poster:      entry.poster      || tmdbData.poster,
      background:  entry.background  || tmdbData.background,
      description: entry.description || tmdbData.description,
      genre:       entry.genre       || tmdbData.genres,
      year:        entry.year        || tmdbData.year,
      imdbRating:  entry.imdbRating  || tmdbData.rating,
      director:    entry.director    || tmdbData.director,
      stars:       entry.stars       || tmdbData.stars,
      duration:    entry.duration    || tmdbData.runtime,
      language:    entry.language    || tmdbData.language,
      tmdbId:      tmdbData.tmdbId,
      imdbId:      entry.imdbId      || tmdbData.imdbId,
      tmdbFetched: true,
    };
  } catch (err) {
    console.error(`[TMDB] Enrichment failed for "${entry.cleanTitle}":`, (err as Error).message);
    return { ...entry, tmdbFetched: true };
  }
}

// ─── Main Fetch & Parse ───────────────────────────────────────────────────────
export async function fetchAndRefresh(forceRenrich = false): Promise<{ added: number; total: number }> {
  const { config } = state;
  if (!config.m3uUrl) throw new Error('No M3U URL configured');

  console.log(`[Store] Fetching M3U from: ${config.m3uUrl}`);
  const content = await fetchWithFallback(config.m3uUrl);

  const parsed = parseM3U(content, config.filterGroups);
  console.log(`[Store] Parsed ${parsed.length} entries`);

  const merged = mergeEntries(state.entries, parsed);

  const toEnrich = merged.filter(e => !e.tmdbFetched || forceRenrich);
  console.log(`[Store] Enriching ${toEnrich.length} entries with TMDB...`);

  const BATCH_SIZE = 5;
  const enriched = [...merged];

  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    const batch = toEnrich.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(e => enrichWithTmdb(e, config.tmdbApiKey)));
    for (const r of results) {
      const idx = enriched.findIndex(e => e.id === r.id);
      if (idx !== -1) enriched[idx] = r;
    }
    if (i + BATCH_SIZE < toEnrich.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const added = enriched.length - state.entries.length;
  state.entries   = enriched;
  state.lastFetched = new Date().toISOString();
  saveState();

  console.log(`[Store] Done. Total: ${enriched.length}, New: ${added}`);
  return { added, total: enriched.length };
}

// ─── Auto-Refresh ─────────────────────────────────────────────────────────────
export function startAutoRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  const ms = (state.config.refreshIntervalHours || 6) * 60 * 60 * 1000;
  refreshTimer = setInterval(async () => {
    try {
      console.log('[Store] Auto-refresh triggered');
      await fetchAndRefresh();
    } catch (err) {
      console.error('[Store] Auto-refresh failed:', (err as Error).message);
    }
  }, ms);
  console.log(`[Store] Auto-refresh scheduled every ${state.config.refreshIntervalHours}h`);
}

// ─── Filter Options ───────────────────────────────────────────────────────────
export interface EntryFilter {
  genre?:    string;
  year?:     string;
  language?: string;
  search?:   string;
}

// ─── Catalog Helpers ──────────────────────────────────────────────────────────
export function getEntries(skip = 0, limit = 100, filters: EntryFilter = {}): MovieEntry[] {
  let entries = state.entries;

  const { genre, year, language, search } = filters;

  if (genre) {
    const g = genre.toLowerCase();
    entries = entries.filter(e => e.genre?.toLowerCase().includes(g));
  }

  if (year) {
    entries = entries.filter(e => e.year === year);
  }

  if (language) {
    const l = language.toLowerCase();
    entries = entries.filter(e => e.language?.toLowerCase() === l);
  }

  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(e =>
      e.cleanTitle.toLowerCase().includes(q) ||
      e.stars?.toLowerCase().includes(q) ||
      e.director?.toLowerCase().includes(q) ||
      e.genre?.toLowerCase().includes(q) ||
      e.year?.includes(q)
    );
  }

  return entries.slice(skip, skip + limit);
}

export function getEntryById(id: string): MovieEntry | undefined {
  return state.entries.find(e => e.id === id);
}

export function getEntryByImdbId(imdbId: string): MovieEntry | undefined {
  return state.entries.find(e => e.imdbId === imdbId || e.imdbId === imdbId.replace(/^tt/, ''));
}

export function getEntryByTmdbId(tmdbId: string): MovieEntry | undefined {
  return state.entries.find(e => e.tmdbId === tmdbId);
}

// ─── Unique value helpers ─────────────────────────────────────────────────────
export function getGenres(): string[] {
  const gs = new Set<string>();
  state.entries.forEach(e =>
    e.genre?.split(',').forEach(g => { const t = g.trim(); if (t) gs.add(t); })
  );
  return [...gs].sort();
}

export function getYears(): string[] {
  return [
    ...new Set(state.entries.map(e => e.year).filter(Boolean) as string[])
  ].sort((a, b) => Number(b) - Number(a));
}

export function getLanguages(): string[] {
  return [
    ...new Set(state.entries.map(e => e.language).filter(Boolean) as string[])
  ].sort();
}
