import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  MovieEntry, AddonConfig, StatusResponse, EntriesResponse, FiltersResponse,
} from './types';

const API: string = import.meta.env.VITE_API_URL ?? '';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg
      className={`animate-spin h-${size} w-${size} text-current`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const cls: Record<string, string> = {
    gray:   'bg-gray-800 text-gray-300',
    green:  'bg-green-900/50 text-green-300 border border-green-700/50',
    red:    'bg-red-900/50 text-red-300 border border-red-700/50',
    yellow: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
    blue:   'bg-blue-900/50 text-blue-300 border border-blue-700/50',
    purple: 'bg-purple-900/50 text-purple-300 border border-purple-700/50',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls[color] ?? cls.gray}`}>
      {children}
    </span>
  );
}

// ─── Select Dropdown ──────────────────────────────────────────────────────────
function Select({
  label, icon, value, options, onChange, placeholder,
}: {
  label: string;
  icon: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-[140px]">
      <label className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest flex items-center gap-1">
        <span>{icon}</span>{label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm
                   focus:outline-none focus:border-red-500 transition-colors cursor-pointer appearance-none
                   pr-8 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iOCIgdmlld0JveD0iMCAwIDEyIDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTEgMUw2IDdMMTEgMSIgc3Ryb2tlPSIjNjM2MzYzIiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+')] bg-no-repeat bg-[right_12px_center]"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Active Filter Chip ───────────────────────────────────────────────────────
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-red-700/30 border border-red-600/40 text-red-300 px-3 py-1 rounded-full text-xs font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-white transition-colors leading-none">✕</button>
    </span>
  );
}

// ─── Movie Card ───────────────────────────────────────────────────────────────
function MovieCard({ entry, onRemove }: { entry: MovieEntry; onRemove: (id: string) => void }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-red-600/50 transition-all duration-200 group relative flex flex-col">
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-gray-800 overflow-hidden flex-shrink-0">
        {entry.poster && !imgErr ? (
          <img
            src={entry.poster}
            alt={entry.cleanTitle}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-gray-700 bg-gradient-to-br from-gray-800 to-gray-900">
            🎬
          </div>
        )}

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

        {/* TMDB badge */}
        {entry.tmdbFetched && (
          <div className="absolute top-2 right-2">
            <span className="bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">TMDB</span>
          </div>
        )}

        {/* Rating */}
        {entry.imdbRating && (
          <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm text-yellow-400 text-xs font-bold px-2 py-0.5 rounded-full">
            ⭐ {entry.imdbRating}
          </div>
        )}

        {/* Year */}
        {entry.year && (
          <div className="absolute bottom-2 right-2 bg-black/60 text-gray-300 text-xs px-1.5 py-0.5 rounded">
            {entry.year}
          </div>
        )}

        {/* Remove */}
        <button
          onClick={() => onRemove(entry.id)}
          className="absolute top-2 left-2 bg-red-600/80 hover:bg-red-600 text-white w-6 h-6 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          ✕
        </button>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1.5 flex-1 flex flex-col">
        <h3 className="text-white text-sm font-semibold leading-tight line-clamp-2 flex-1">
          {entry.cleanTitle}
        </h3>
        <div className="flex flex-wrap gap-1">
          {entry.language && <Badge color="blue">{entry.language}</Badge>}
        </div>
        {entry.genre && (
          <p className="text-gray-500 text-xs line-clamp-1">{entry.genre}</p>
        )}
        {entry.duration && (
          <p className="text-gray-600 text-xs">⏱ {entry.duration}</p>
        )}
        {entry.director && (
          <p className="text-gray-500 text-xs line-clamp-1 truncate">🎬 {entry.director}</p>
        )}
        {entry.description && (
          <p className="text-gray-500 text-xs line-clamp-2 mt-1">{entry.description}</p>
        )}
        <div className="pt-1">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-red-400 hover:text-red-300 text-xs truncate block"
            title={entry.url}
          >
            ▶ Stream URL
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────
interface ActiveFilters {
  search: string;
  genre: string;
  year: string;
  language: string;
}

function FilterBar({
  filters,
  filterOptions,
  onChange,
  onClear,
  total,
  showing,
  loading,
}: {
  filters: ActiveFilters;
  filterOptions: FiltersResponse;
  onChange: (f: Partial<ActiveFilters>) => void;
  onClear: () => void;
  total: number;
  showing: number;
  loading: boolean;
}) {
  const hasActive =
    filters.search || filters.genre || filters.year || filters.language;

  return (
    <div className="space-y-3">
      {/* Filter Controls Row */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Search */}
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest flex items-center gap-1">
            🔍 Search
          </label>
          <div className="relative">
            <input
              type="text"
              value={filters.search}
              onChange={e => onChange({ search: e.target.value })}
              placeholder="Movie title, director, cast..."
              className="w-full bg-gray-900 border border-gray-700 text-white rounded-xl pl-4 pr-4 py-2 text-sm
                         focus:outline-none focus:border-red-500 transition-colors placeholder-gray-600"
            />
          </div>
        </div>

        {/* Genre */}
        {filterOptions.genres.length > 0 && (
          <Select
            label="Genre"
            icon="🎭"
            value={filters.genre}
            options={filterOptions.genres}
            onChange={v => onChange({ genre: v })}
            placeholder="All Genres"
          />
        )}

        {/* Year */}
        {filterOptions.years.length > 0 && (
          <Select
            label="Year"
            icon="📅"
            value={filters.year}
            options={filterOptions.years}
            onChange={v => onChange({ year: v })}
            placeholder="All Years"
          />
        )}

        {/* Language */}
        {filterOptions.languages.length > 0 && (
          <Select
            label="Language"
            icon="🌐"
            value={filters.language}
            options={filterOptions.languages}
            onChange={v => onChange({ language: v })}
            placeholder="All Languages"
          />
        )}

        {/* Clear All */}
        {hasActive && (
          <button
            onClick={onClear}
            className="self-end bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Active Filter Chips + Count */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-wrap gap-2 items-center">
          {filters.genre    && <FilterChip label={`Genre: ${filters.genre}`}    onRemove={() => onChange({ genre: '' })} />}
          {filters.year     && <FilterChip label={`Year: ${filters.year}`}       onRemove={() => onChange({ year: '' })} />}
          {filters.language && <FilterChip label={`Lang: ${filters.language}`}   onRemove={() => onChange({ language: '' })} />}
          {filters.search   && <FilterChip label={`"${filters.search}"`}         onRemove={() => onChange({ search: '' })} />}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {loading && <span className="flex items-center gap-1"><Spinner size={3} /> Loading...</span>}
          <span>
            Showing <span className="text-white font-semibold">{showing}</span>
            {' '}of{' '}
            <span className="text-white font-semibold">{total}</span>
            {' '}movies
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Status Bar ───────────────────────────────────────────────────────────────
function StatusBar({ status }: { status: StatusResponse | null }) {
  if (!status) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Total Movies',  value: status.total,                                                         icon: '🎬', color: 'red' },
        { label: 'TMDB',          value: status.config.tmdbConfigured ? '✅ Active' : '⚠️ Not set',            icon: '🎭', color: status.config.tmdbConfigured ? 'green' : 'yellow' },
        { label: 'Last Refresh',  value: status.lastFetched ? new Date(status.lastFetched).toLocaleTimeString() : 'Never', icon: '🕐', color: 'gray' },
        { label: 'Auto-Refresh',  value: `Every ${status.config.refreshIntervalHours}h`,                       icon: '🔄', color: 'blue' },
      ].map(s => (
        <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
            <span>{s.icon}</span>
            <span className="uppercase tracking-wide font-medium">{s.label}</span>
          </div>
          <p className={`font-bold text-lg ${
            s.color === 'red'    ? 'text-red-400'    :
            s.color === 'green'  ? 'text-green-400'  :
            s.color === 'yellow' ? 'text-yellow-400' :
            s.color === 'blue'   ? 'text-blue-400'   : 'text-white'
          }`}>
            {String(s.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Config Panel ─────────────────────────────────────────────────────────────
function ConfigPanel({
  status, onSave, onRefresh, onFullRefresh, saving, refreshing,
}: {
  status: StatusResponse | null;
  onSave: (cfg: Partial<AddonConfig>) => Promise<void>;
  onRefresh: () => Promise<void>;
  onFullRefresh: () => Promise<void>;
  saving: boolean;
  refreshing: boolean;
}) {
  const [form, setForm] = useState<Partial<AddonConfig>>({
    m3uUrl:              '',
    tmdbApiKey:          '',
    addonName:           'VT Tamil Movies',
    addonId:             'com.vt.tamil.stremio',
    addonVersion:        '1.0.0',
    addonDescription:    'Tamil movies addon powered by VT collection',
    filterGroups:        ['VT 🎬 | Tamil Movies'],
    refreshIntervalHours: 6,
  });
  const [filterGroupStr, setFilterGroupStr] = useState('VT 🎬 | Tamil Movies');

  useEffect(() => {
    if (status?.config) {
      setForm(prev => ({
        ...prev,
        m3uUrl:              status.config.m3uUrl || '',
        addonName:           status.config.addonName || prev.addonName,
        addonId:             status.config.addonId   || prev.addonId,
        filterGroups:        status.config.filterGroups || prev.filterGroups,
        refreshIntervalHours: status.config.refreshIntervalHours || 6,
      }));
      setFilterGroupStr((status.config.filterGroups || []).join('\n'));
    }
  }, [status]);

  const handleSave = async () => {
    const groups = filterGroupStr.split('\n').map(s => s.trim()).filter(Boolean);
    await onSave({ ...form, filterGroups: groups });
  };

  const field = (
    label: string,
    key: keyof AddonConfig,
    type = 'text',
    placeholder = '',
    hint?: string,
  ) => (
    <div className="space-y-1.5">
      <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">{label}</label>
      <input
        type={type}
        value={String(form[key] ?? '')}
        onChange={e => setForm(p => ({
          ...p,
          [key]: type === 'number' ? Number(e.target.value) : e.target.value,
        }))}
        placeholder={placeholder}
        className="w-full bg-gray-950 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm
                   focus:outline-none focus:border-red-500 transition-colors placeholder-gray-600"
      />
      {hint && <p className="text-gray-600 text-xs">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Addon URL */}
      {status?.addonUrl && (
        <div className="bg-gradient-to-r from-red-900/30 to-red-800/10 border border-red-700/50 rounded-xl p-4">
          <p className="text-red-300 text-xs font-semibold uppercase tracking-wide mb-2">🔗 Stremio Addon URL</p>
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-black/40 text-green-400 rounded-lg px-3 py-2 text-sm font-mono break-all">
              {status.addonUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(status.addonUrl)}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
            >
              Copy
            </button>
          </div>
          <p className="text-gray-500 text-xs mt-2">
            Paste this URL into Stremio → Add-ons → Community Add-ons → Paste URL
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Source Config */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <span>📡</span> M3U Source
          </h3>
          {field('Raw GitHub M3U URL', 'm3uUrl', 'text', 'https://raw.githubusercontent.com/…')}
          <div className="space-y-1.5">
            <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">
              Filter Groups <span className="normal-case text-gray-600">(one per line)</span>
            </label>
            <textarea
              rows={3}
              value={filterGroupStr}
              onChange={e => setFilterGroupStr(e.target.value)}
              placeholder="VT 🎬 | Tamil Movies"
              className="w-full bg-gray-950 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-red-500 transition-colors placeholder-gray-600 resize-none"
            />
          </div>
          {field('Auto-Refresh Interval (hours)', 'refreshIntervalHours', 'number', '6')}
        </div>

        {/* TMDB + Addon Meta */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <span>🎭</span> TMDB & Addon Info
          </h3>
          <div className="space-y-1.5">
            <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">TMDB API Key</label>
            <input
              type="password"
              value={String(form.tmdbApiKey ?? '')}
              onChange={e => setForm(p => ({ ...p, tmdbApiKey: e.target.value }))}
              placeholder="Your TMDB v3 API key"
              className="w-full bg-gray-950 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-red-500 transition-colors placeholder-gray-600"
            />
            <p className="text-gray-600 text-xs">
              Free key at{' '}
              <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                themoviedb.org
              </a>
              . Also set <code className="bg-gray-800 px-1 rounded text-xs">TMDB_API_KEY</code> env var.
            </p>
          </div>
          {field('Addon Name',        'addonName',        'text', 'VT Tamil Movies')}
          {field('Addon ID',          'addonId',          'text', 'com.vt.tamil.stremio')}
          {field('Addon Version',     'addonVersion',     'text', '1.0.0')}
          {field('Description',       'addonDescription', 'text', 'Tamil movies addon')}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-colors flex items-center gap-2"
        >
          {saving ? <><Spinner /> Saving…</> : '💾 Save Config'}
        </button>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-colors flex items-center gap-2"
        >
          {refreshing ? <><Spinner /> Refreshing…</> : '⚡ Refresh M3U'}
        </button>
        <button
          onClick={onFullRefresh}
          disabled={refreshing}
          className="bg-blue-700 hover:bg-blue-600 disabled:bg-gray-800 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-colors flex items-center gap-2"
        >
          {refreshing ? <><Spinner /> Working…</> : '🔄 Full TMDB Re-enrich'}
        </button>
      </div>
    </div>
  );
}

// ─── Deploy Panel ─────────────────────────────────────────────────────────────
function DeployPanel({ addonUrl }: { addonUrl?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };
  const CopyBtn = ({ text, id }: { text: string; id: string }) => (
    <button
      onClick={() => copy(text, id)}
      className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors"
    >
      {copied === id ? '✅ Copied' : '📋 Copy'}
    </button>
  );

  const CODE = {
    env: `TMDB_API_KEY=your_tmdb_api_key_here\nM3U_URL=https://raw.githubusercontent.com/your/repo/main/playlist.m3u\nPORT=7000`,
    render: `# Build Command\nnpm run build\n\n# Start Command\nnode --loader tsx/esm server/index.ts`,
    start:  `npm run build && node --loader tsx/esm server/index.ts`,
    docker: `FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nRUN npm run build\nEXPOSE 7000\nCMD ["node", "--loader", "tsx/esm", "server/index.ts"]`,
  };

  return (
    <div className="space-y-6">
      {addonUrl && (
        <div className="bg-gradient-to-r from-green-900/30 to-green-800/10 border border-green-700/50 rounded-xl p-4">
          <p className="text-green-300 text-xs font-semibold uppercase mb-2">🎉 Your Addon URL</p>
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-black/40 text-green-400 rounded-lg px-3 py-2 text-sm font-mono break-all">{addonUrl}</code>
            <CopyBtn text={addonUrl} id="addonUrl" />
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-white font-semibold">🔐 Environment Variables</h3>
          <div className="relative">
            <pre className="bg-gray-950 text-green-400 text-xs font-mono rounded-lg p-4 overflow-x-auto">{CODE.env}</pre>
            <div className="absolute top-2 right-2"><CopyBtn text={CODE.env} id="env" /></div>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <span className="bg-purple-600 text-white text-xs px-2 py-0.5 rounded font-bold">Render</span>
            Render.com
          </h3>
          <ol className="text-gray-400 text-sm space-y-1 list-decimal list-inside">
            <li>Push project to GitHub</li>
            <li>Create a new <strong className="text-white">Web Service</strong></li>
            <li>Connect your GitHub repo</li>
            <li>Set build & start commands</li>
            <li>Add environment variables</li>
          </ol>
          <div className="relative">
            <pre className="bg-gray-950 text-green-400 text-xs font-mono rounded-lg p-4 overflow-x-auto">{CODE.render}</pre>
            <div className="absolute top-2 right-2"><CopyBtn text={CODE.render} id="render" /></div>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-white font-semibold">🚂 Railway / Fly.io</h3>
          <div className="relative">
            <pre className="bg-gray-950 text-green-400 text-xs font-mono rounded-lg p-4 overflow-x-auto">{CODE.start}</pre>
            <div className="absolute top-2 right-2"><CopyBtn text={CODE.start} id="start" /></div>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-white font-semibold">🐳 Docker</h3>
          <div className="relative">
            <pre className="bg-gray-950 text-green-400 text-xs font-mono rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">{CODE.docker}</pre>
            <div className="absolute top-2 right-2"><CopyBtn text={CODE.docker} id="docker" /></div>
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4">📱 Stremio Filter Catalogs</h3>
        <p className="text-gray-400 text-sm mb-4">
          The addon exposes <strong className="text-white">5 catalog views</strong> in Stremio, each with its own filter:
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { icon: '🎬', name: 'All Movies',      desc: 'Paginated full list, no filter required.' },
            { icon: '🎭', name: 'By Genre',         desc: 'Dropdown of all genres (Action, Drama, Comedy…).' },
            { icon: '📅', name: 'By Year',          desc: 'Dropdown of release years (2026, 2025…).' },
            { icon: '🌐', name: 'By Language',      desc: 'Filter by Tamil, Hindi, Telugu, etc.' },
            { icon: '🔍', name: 'Search',           desc: 'Full-text search by title, director, cast.' },
          ].map(c => (
            <div key={c.name} className="bg-gray-950 border border-gray-800 rounded-lg p-3 flex items-start gap-3">
              <span className="text-2xl">{c.icon}</span>
              <div>
                <p className="text-white text-sm font-semibold">{c.name}</p>
                <p className="text-gray-500 text-xs mt-0.5">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid sm:grid-cols-3 gap-4">
          {[
            { step: '1', title: 'Get Addon URL',  desc: 'Copy the /manifest.json URL from the Configuration tab.' },
            { step: '2', title: 'Open Stremio',   desc: 'Add-ons → ⚙ icon → Install from URL.' },
            { step: '3', title: 'Browse & Filter',desc: 'Use Genre / Year / Language dropdowns in Stremio catalog.' },
          ].map(s => (
            <div key={s.step} className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-red-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">{s.step}</div>
              <div>
                <p className="text-white font-medium text-sm">{s.title}</p>
                <p className="text-gray-400 text-xs mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
type Tab = 'catalog' | 'config' | 'deploy';

const EMPTY_FILTERS: ActiveFilters = { search: '', genre: '', year: '', language: '' };
const LIMIT = 48;

export default function App() {
  const [activeTab,     setActiveTab]     = useState<Tab>('catalog');
  const [status,        setStatus]        = useState<StatusResponse | null>(null);
  const [entries,       setEntries]       = useState<MovieEntry[]>([]);
  const [totalEntries,  setTotalEntries]  = useState(0);
  const [skip,          setSkip]          = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [serverOnline,  setServerOnline]  = useState<boolean | null>(null);
  const [filters,       setFilters]       = useState<ActiveFilters>(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState<FiltersResponse>({ genres: [], years: [], languages: [] });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch server status ──────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const s = await apiFetch<StatusResponse>('/api/status');
      setStatus(s);
      setServerOnline(true);
    } catch {
      setServerOnline(false);
    }
  }, []);

  // ── Fetch filter options ─────────────────────────────────────────────────────
  const fetchFilterOptions = useCallback(async () => {
    try {
      const f = await apiFetch<FiltersResponse>('/api/filters');
      setFilterOptions(f);
    } catch { /* ignore */ }
  }, []);

  // ── Fetch entries ────────────────────────────────────────────────────────────
  const fetchEntries = useCallback(async (s: number, f: ActiveFilters) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ skip: String(s), limit: String(LIMIT) });
      if (f.search)   params.set('search',   f.search);
      if (f.genre)    params.set('genre',    f.genre);
      if (f.year)     params.set('year',     f.year);
      if (f.language) params.set('language', f.language);

      const data = await apiFetch<EntriesResponse>(`/api/entries?${params}`);

      if (s === 0) setEntries(data.entries);
      else         setEntries(prev => [...prev, ...data.entries]);

      setTotalEntries(data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Status polling ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStatus();
    fetchFilterOptions();
    const interval = setInterval(() => {
      fetchStatus();
      fetchFilterOptions();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchFilterOptions]);

  // ── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchEntries(0, EMPTY_FILTERS);
  }, [fetchEntries]);

  // ── Debounced filter change ──────────────────────────────────────────────────
  const handleFilterChange = (partial: Partial<ActiveFilters>) => {
    const next = { ...filters, ...partial };
    setFilters(next);
    setSkip(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchEntries(0, next), 350);
  };

  const handleClearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSkip(0);
    fetchEntries(0, EMPTY_FILTERS);
  };

  // ── Actions ──────────────────────────────────────────────────────────────────
  const handleSaveConfig = async (cfg: Partial<AddonConfig>) => {
    setSaving(true); setError(null);
    try {
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(cfg) });
      await fetchStatus();
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleRefresh = async () => {
    setRefreshing(true); setError(null);
    try {
      await apiFetch('/api/refresh', { method: 'POST' });
      await fetchStatus();
      await fetchFilterOptions();
      await fetchEntries(0, filters);
    } catch (err) { setError((err as Error).message); }
    finally { setRefreshing(false); }
  };

  const handleFullRefresh = async () => {
    setRefreshing(true); setError(null);
    try {
      await apiFetch('/api/refresh/full', { method: 'POST' });
      await fetchStatus();
      await fetchFilterOptions();
      await fetchEntries(0, filters);
    } catch (err) { setError((err as Error).message); }
    finally { setRefreshing(false); }
  };

  const handleRemove = async (id: string) => {
    try {
      await apiFetch(`/api/entries/${id}`, { method: 'DELETE' });
      setEntries(prev => prev.filter(e => e.id !== id));
      setTotalEntries(prev => prev - 1);
    } catch (err) { setError((err as Error).message); }
  };

  const handleLoadMore = () => {
    const next = skip + LIMIT;
    setSkip(next);
    fetchEntries(next, filters);
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'catalog', label: 'Movie Catalog', icon: '🎬' },
    { id: 'config',  label: 'Configuration', icon: '⚙️' },
    { id: 'deploy',  label: 'Deploy',         icon: '🚀' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-gray-900/95 backdrop-blur border-b border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">

            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-xl shadow-lg shadow-red-900/40">
                🎬
              </div>
              <div>
                <h1 className="text-white font-extrabold text-lg leading-tight">VT Stremio Addon</h1>
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    serverOnline === true  ? 'bg-green-400 animate-pulse' :
                    serverOnline === false ? 'bg-red-500'                 :
                    'bg-yellow-400 animate-pulse'
                  }`} />
                  <p className="text-gray-400 text-xs">
                    {serverOnline === true  ? 'Server Online'  :
                     serverOnline === false ? 'Server Offline' : 'Connecting…'}
                  </p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <nav className="flex gap-1">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all
                    ${activeTab === t.id
                      ? 'bg-red-600 text-white shadow-lg shadow-red-900/40'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                >
                  <span>{t.icon}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </nav>

            {/* Stats */}
            {status && (
              <div className="hidden md:flex items-center gap-3 text-xs text-gray-400">
                <span className="bg-gray-800 px-2 py-1 rounded-lg">
                  📽 {status.total} movies
                </span>
                {filterOptions.genres.length > 0 && (
                  <span className="bg-gray-800 px-2 py-1 rounded-lg">
                    🎭 {filterOptions.genres.length} genres
                  </span>
                )}
                {filterOptions.years.length > 0 && (
                  <span className="bg-gray-800 px-2 py-1 rounded-lg">
                    📅 {filterOptions.years[0]}–{filterOptions.years[filterOptions.years.length - 1]}
                  </span>
                )}
                <span className={`px-2 py-1 rounded-lg ${
                  status.config.tmdbConfigured
                    ? 'bg-blue-900/50 text-blue-300'
                    : 'bg-yellow-900/30 text-yellow-400'
                }`}>
                  {status.config.tmdbConfigured ? '🎭 TMDB Active' : '⚠️ No TMDB Key'}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Server offline */}
        {serverOnline === false && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-5 text-center">
            <p className="text-red-300 font-semibold text-lg mb-1">⚠️ Server Not Running</p>
            <p className="text-red-400/80 text-sm">
              Start the addon server:{' '}
              <code className="bg-black/30 px-2 py-0.5 rounded font-mono text-xs">
                node --loader tsx/esm server/index.ts
              </code>
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 flex items-start gap-3">
            <span className="text-red-400">⚠️</span>
            <p className="text-red-300 text-sm flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-gray-500 hover:text-white">✕</button>
          </div>
        )}

        {/* ── Catalog Tab ───────────────────────────────────────────────────── */}
        {activeTab === 'catalog' && (
          <div className="space-y-5">

            <StatusBar status={status} />

            {/* Filter Bar */}
            <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-4">
              <FilterBar
                filters={filters}
                filterOptions={filterOptions}
                onChange={handleFilterChange}
                onClear={handleClearFilters}
                total={totalEntries}
                showing={entries.length}
                loading={loading}
              />
            </div>

            {/* Refresh action */}
            <div className="flex justify-end">
              <button
                onClick={handleRefresh}
                disabled={refreshing || serverOnline === false}
                className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
              >
                {refreshing ? <><Spinner /> Refreshing…</> : '⚡ Refresh M3U'}
              </button>
            </div>

            {/* Empty state */}
            {entries.length === 0 && !loading ? (
              <div className="text-center py-24">
                <div className="text-7xl mb-4">🎬</div>
                <p className="text-gray-400 text-xl font-semibold mb-2">
                  {serverOnline === false
                    ? 'Start the server to load movies'
                    : (filters.genre || filters.year || filters.language || filters.search)
                    ? 'No movies match the selected filters'
                    : 'No movies loaded yet'}
                </p>
                <p className="text-gray-600 text-sm">
                  {serverOnline === true && !filters.genre && !filters.year && !filters.language && !filters.search
                    ? 'Go to Configuration, set your M3U URL and click Refresh M3U'
                    : filters.genre || filters.year || filters.language || filters.search
                    ? 'Try adjusting or clearing your filters'
                    : 'Run: node --loader tsx/esm server/index.ts'}
                </p>
                {(filters.genre || filters.year || filters.language || filters.search) && (
                  <button
                    onClick={handleClearFilters}
                    className="mt-4 bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              /* Movie Grid */
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {entries.map(e => (
                  <MovieCard key={e.id} entry={e} onRemove={handleRemove} />
                ))}
              </div>
            )}

            {/* Load More */}
            {entries.length < totalEntries && entries.length > 0 && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="bg-gray-800 hover:bg-gray-700 text-white px-8 py-3 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {loading
                    ? <><Spinner /> Loading…</>
                    : `Load More (${totalEntries - entries.length} remaining)`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Config Tab ────────────────────────────────────────────────────── */}
        {activeTab === 'config' && (
          <ConfigPanel
            status={status}
            onSave={handleSaveConfig}
            onRefresh={handleRefresh}
            onFullRefresh={handleFullRefresh}
            saving={saving}
            refreshing={refreshing}
          />
        )}

        {/* ── Deploy Tab ────────────────────────────────────────────────────── */}
        {activeTab === 'deploy' && (
          <DeployPanel addonUrl={status?.addonUrl} />
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-800 mt-12 py-6">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-gray-500 text-xs">
          <div className="flex items-center gap-2">
            <span>🎬</span>
            <span>VT Stremio Addon • M3U + TMDB Powered</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Filters: Genre · Year · Language · Search</span>
            <span>Keep-alive: 14 min</span>
            <span>Auto-refresh: {status?.config.refreshIntervalHours ?? 6}h</span>
            <span className="text-green-400">● Free Tier Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
