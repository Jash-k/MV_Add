export interface MovieEntry {
  id: string;
  title: string;
  cleanTitle: string;
  url: string;
  poster: string;
  background: string;
  logo: string;
  groupTitle: string;
  type: string;
  imdbRating?: string;
  imdbId?: string;
  tmdbId?: string;
  year?: string;
  genre?: string;
  duration?: string;
  director?: string;
  writers?: string;
  stars?: string;
  language?: string;
  description?: string;
  tmdbFetched?: boolean;
}

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

export interface StatusResponse {
  ok: boolean;
  total: number;
  lastFetched: string | null;
  config: {
    addonName: string;
    addonId: string;
    m3uUrl: string;
    filterGroups: string[];
    refreshIntervalHours: number;
    tmdbConfigured: boolean;
  };
  addonUrl: string;
}

export interface EntriesResponse {
  total: number;
  skip: number;
  limit: number;
  entries: MovieEntry[];
}

export interface FiltersResponse {
  genres: string[];
  years: string[];
  languages: string[];
}
