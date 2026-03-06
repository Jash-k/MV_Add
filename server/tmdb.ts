// ─── TMDB API Integration ─────────────────────────────────────────────────────

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p';

export interface TmdbMovieResult {
  tmdbId: string;
  imdbId?: string;
  title: string;
  originalTitle: string;
  year: string;
  description: string;
  poster: string;         // full URL
  background: string;     // full URL
  genres: string;
  runtime: string;
  rating: string;
  director: string;
  stars: string;
  language: string;
}

interface TmdbSearchItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  original_language?: string;
}

interface TmdbMovieDetail {
  id: number;
  imdb_id?: string;
  title: string;
  original_title: string;
  release_date: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  runtime?: number;
  original_language: string;
  genres: Array<{ id: number; name: string }>;
  credits?: {
    crew: Array<{ job: string; name: string }>;
    cast: Array<{ name: string; order: number }>;
  };
}

function buildPosterUrl(path: string | null | undefined, size = 'w500'): string {
  if (!path) return '';
  return `${TMDB_IMG}/${size}${path}`;
}

function buildBackdropUrl(path: string | null | undefined, size = 'w1280'): string {
  if (!path) return '';
  return `${TMDB_IMG}/${size}${path}`;
}

async function tmdbFetch<T>(path: string, apiKey: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`TMDB ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function searchTmdbMovie(
  title: string,
  year: string | undefined,
  apiKey: string
): Promise<TmdbMovieResult | null> {
  try {
    const params: Record<string, string> = { query: title, language: 'en-US', page: '1' };
    if (year) params['year'] = year;

    const data = await tmdbFetch<{ results: TmdbSearchItem[] }>('/search/movie', apiKey, params);

    if (!data.results?.length) {
      // Retry without year constraint
      if (year) {
        const data2 = await tmdbFetch<{ results: TmdbSearchItem[] }>('/search/movie', apiKey, {
          query: title, language: 'en-US', page: '1',
        });
        if (!data2.results?.length) return null;
        return fetchMovieDetail(data2.results[0].id, apiKey);
      }
      return null;
    }

    return fetchMovieDetail(data.results[0].id, apiKey);
  } catch (err) {
    console.error(`[TMDB] Search failed for "${title}":`, (err as Error).message);
    return null;
  }
}

async function fetchMovieDetail(tmdbId: number, apiKey: string): Promise<TmdbMovieResult | null> {
  try {
    const detail = await tmdbFetch<TmdbMovieDetail>(
      `/movie/${tmdbId}`,
      apiKey,
      { append_to_response: 'credits', language: 'en-US' }
    );

    const director = detail.credits?.crew
      .filter(c => c.job === 'Director')
      .map(c => c.name)
      .join(', ') || '';

    const stars = detail.credits?.cast
      .sort((a, b) => a.order - b.order)
      .slice(0, 5)
      .map(c => c.name)
      .join(', ') || '';

    const genres = detail.genres?.map(g => g.name).join(', ') || '';
    const runtime = detail.runtime ? `${Math.floor(detail.runtime / 60)}h ${detail.runtime % 60}m` : '';

    return {
      tmdbId: String(detail.id),
      imdbId: detail.imdb_id,
      title: detail.title,
      originalTitle: detail.original_title,
      year: detail.release_date?.slice(0, 4) || '',
      description: detail.overview || '',
      poster: buildPosterUrl(detail.poster_path, 'w500'),
      background: buildBackdropUrl(detail.backdrop_path, 'w1280'),
      genres,
      runtime,
      rating: detail.vote_average ? detail.vote_average.toFixed(1) : '',
      director,
      stars,
      language: detail.original_language || '',
    };
  } catch (err) {
    console.error(`[TMDB] Detail fetch failed for id ${tmdbId}:`, (err as Error).message);
    return null;
  }
}

// Fetch by IMDB ID directly
export async function fetchTmdbByImdbId(imdbId: string, apiKey: string): Promise<TmdbMovieResult | null> {
  try {
    const data = await tmdbFetch<{ movie_results: TmdbSearchItem[] }>(
      `/find/${imdbId}`,
      apiKey,
      { external_source: 'imdb_id' }
    );
    const result = data.movie_results?.[0];
    if (!result) return null;
    return fetchMovieDetail(result.id, apiKey);
  } catch (err) {
    console.error(`[TMDB] FindByImdb failed for "${imdbId}":`, (err as Error).message);
    return null;
  }
}
