// ─── Stremio Addon Routes ─────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import {
  getState, getEntries, getEntryById, getEntryByImdbId,
  getEntryByTmdbId, getGenres, getYears, getLanguages,
} from './store.js';

const router = Router();

// ─── CORS Middleware (required by Stremio) ────────────────────────────────────
router.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Content-Type', 'application/json');
  next();
});

// ─── Build meta object from entry ────────────────────────────────────────────
function buildMeta(e: ReturnType<typeof getEntryById>) {
  if (!e) return null;
  const metaId = e.imdbId
    ? e.imdbId.startsWith('tt') ? e.imdbId : `tt${e.imdbId}`
    : e.tmdbId
    ? `tmdb:${e.tmdbId}`
    : e.id;

  return {
    id: metaId,
    type: 'movie' as const,
    name: e.cleanTitle,
    poster: e.poster || undefined,
    background: e.background || undefined,
    logo: e.logo || undefined,
    description: e.description || undefined,
    year: e.year ? parseInt(e.year, 10) : undefined,
    imdbRating: e.imdbRating || undefined,
    genres: e.genre ? e.genre.split(',').map(g => g.trim()).filter(Boolean) : [],
    director: e.director ? [e.director] : [],
    cast: e.stars ? e.stars.split(',').map(s => s.trim()).filter(Boolean) : [],
    runtime: e.duration || undefined,
    language: e.language || undefined,
    links: [
      ...(e.imdbId ? [{ name: 'IMDb', category: 'imdb', url: `https://imdb.com/title/${e.imdbId}` }] : []),
      ...(e.tmdbId ? [{ name: 'TMDB', category: 'tmdb', url: `https://themoviedb.org/movie/${e.tmdbId}` }] : []),
    ],
  };
}

// ─── Manifest ─────────────────────────────────────────────────────────────────
router.get('/manifest.json', (_req: Request, res: Response) => {
  const { config, entries } = getState();
  const genres    = getGenres();
  const years     = getYears();
  const languages = getLanguages();

  /* ── Stremio extra descriptors ────────────────────────────────────────────
   *  Each catalog declares which "extra" filters it supports.
   *  Stremio renders these as dropdown / search filters on the catalog page.
   * ───────────────────────────────────────────────────────────────────────── */

  const catalogs = [
    // ── All movies (no required filter) ────────────────────────────────────
    {
      id: 'vt-all',
      type: 'movie',
      name: `${config.addonName} — All`,
      extra: [
        { name: 'skip', isRequired: false },
      ],
    },

    // ── Genre filter ────────────────────────────────────────────────────────
    ...(genres.length > 0 ? [{
      id: 'vt-genre',
      type: 'movie',
      name: `${config.addonName} — Genre`,
      extra: [
        {
          name: 'genre',
          isRequired: false,
          options: genres,
        },
        { name: 'skip', isRequired: false },
      ],
    }] : []),

    // ── Year filter ─────────────────────────────────────────────────────────
    ...(years.length > 0 ? [{
      id: 'vt-year',
      type: 'movie',
      name: `${config.addonName} — Year`,
      extra: [
        {
          name: 'genre',           // Stremio reuses "genre" slot for any option list
          isRequired: false,
          options: years,          // year strings like "2026", "2025" …
          optionLabel: 'Year',
        },
        { name: 'skip', isRequired: false },
      ],
    }] : []),

    // ── Language filter ─────────────────────────────────────────────────────
    ...(languages.length > 0 ? [{
      id: 'vt-lang',
      type: 'movie',
      name: `${config.addonName} — Language`,
      extra: [
        {
          name: 'genre',
          isRequired: false,
          options: languages,
          optionLabel: 'Language',
        },
        { name: 'skip', isRequired: false },
      ],
    }] : []),

    // ── Search ──────────────────────────────────────────────────────────────
    {
      id: 'vt-search',
      type: 'movie',
      name: `${config.addonName} — Search`,
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip',   isRequired: false },
      ],
    },
  ];

  const manifest = {
    id: config.addonId,
    version: config.addonVersion,
    name: config.addonName,
    description: config.addonDescription,
    logo: entries.find(e => e.poster)?.poster || '',
    background: entries.find(e => e.background)?.background || '',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie'],
    idPrefixes: ['tt', 'tmdb:', 'vt_'],
    behaviorHints: {
      adult: false,
      configurable: true,
      configurationRequired: false,
    },
    catalogs,
  };

  res.json(manifest);
});

// ─── Parse extra path segment ─────────────────────────────────────────────────
// Stremio sends extras as: /catalog/movie/vt-genre/genre=Action&skip=0.json
function parseExtra(extra?: string): {
  skip: number;
  genre?: string;
  search?: string;
  year?: string;
  language?: string;
} {
  const result: ReturnType<typeof parseExtra> = { skip: 0 };
  if (!extra) return result;

  const decoded = decodeURIComponent(extra);
  for (const pair of decoded.split('&')) {
    const [k, ...rest] = pair.split('=');
    const v = rest.join('=');
    if (k === 'skip')   result.skip     = parseInt(v || '0', 10) || 0;
    if (k === 'genre')  result.genre    = v;
    if (k === 'search') result.search   = v;
    if (k === 'year')   result.year     = v;
    if (k === 'lang')   result.language = v;
  }
  return result;
}

// ─── Catalog ──────────────────────────────────────────────────────────────────
router.get('/catalog/:type/:id/:extra?.json', (req: Request, res: Response) => {
  const { type, id } = req.params;
  const extra = req.params.extra as string | undefined;

  if (type !== 'movie') return res.json({ metas: [] });

  const { skip, genre, search, year, language } = parseExtra(extra);

  // Search catalog: require a search term
  if (id === 'vt-search' && !search) return res.json({ metas: [] });

  let filterGenre: string | undefined;
  let filterYear: string | undefined;
  let filterLanguage: string | undefined;
  let filterSearch: string | undefined = search;

  // Route-specific filter mapping
  // vt-genre  → filter by genre
  // vt-year   → the "genre" slot carries the selected year
  // vt-lang   → the "genre" slot carries the selected language
  if (id === 'vt-genre')  filterGenre    = genre;
  if (id === 'vt-year')   filterYear     = genre;   // year value is passed in "genre" slot
  if (id === 'vt-lang')   filterLanguage = genre;   // language passed in "genre" slot
  if (id === 'vt-all')    { /* no extra filter */ }

  const entries = getEntries(skip, 100, {
    genre: filterGenre,
    year: filterYear,
    language: filterLanguage,
    search: filterSearch,
  });

  const metas = entries
    .map(e => buildMeta(e))
    .filter(Boolean)
    .filter(m => m!.name);

  res.json({ metas });
});

// ─── Meta ─────────────────────────────────────────────────────────────────────
router.get('/meta/:type/:id.json', (req: Request, res: Response) => {
  const { type, id } = req.params;
  if (type !== 'movie') return res.json({ meta: null });

  let entry = getEntryById(id);
  if (!entry && id.startsWith('tt'))    entry = getEntryByImdbId(id);
  if (!entry && id.startsWith('tmdb:')) entry = getEntryByTmdbId(id.replace('tmdb:', ''));

  if (!entry) return res.json({ meta: null });

  const meta = buildMeta(entry);
  if (!meta) return res.json({ meta: null });

  res.json({
    meta: {
      ...meta,
      videos: [],
      trailers: [],
    },
  });
});

// ─── Stream ───────────────────────────────────────────────────────────────────
router.get('/stream/:type/:id.json', (req: Request, res: Response) => {
  const { type, id } = req.params;
  if (type !== 'movie') return res.json({ streams: [] });

  let entry = getEntryById(id);
  if (!entry && id.startsWith('tt'))    entry = getEntryByImdbId(id);
  if (!entry && id.startsWith('tmdb:')) entry = getEntryByTmdbId(id.replace('tmdb:', ''));

  if (!entry || !entry.url) return res.json({ streams: [] });

  const streams = [
    {
      url: entry.url,
      name: '▶ VT Stream',
      title: [
        entry.cleanTitle,
        entry.year          ? `(${entry.year})`       : '',
        entry.imdbRating    ? `⭐ ${entry.imdbRating}` : '',
        entry.duration      ? `⏱ ${entry.duration}`   : '',
      ].filter(Boolean).join(' '),
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `vt-${entry.groupTitle}`,
      },
    },
  ];

  res.json({ streams });
});

export default router;
