import { useState, useCallback } from 'react';

interface ParsedItem {
  title: string;
  year: number | null;
  imdbRating: number | null;
  poster: string;
  group: string;
  genre: string[];
  duration: string | null;
  director: string | null;
  stars: string[];
  language: string | null;
  streamUrl: string;
}

interface GroupInfo {
  name: string;
  count: number;
  items: ParsedItem[];
}

interface ScanResult {
  total: number;
  groups: GroupInfo[];
  allGenres: string[];
  withPoster: number;
  avgRating: string | null;
  minYear: number | null;
  maxYear: number | null;
}

// ─── Client-side M3U Parser ───────────────────────────
function parseM3UClient(raw: string): ParsedItem[] {
  const lines = raw.split(/\r?\n/);
  const items: ParsedItem[] = [];
  let curExtInf: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#EXTINF:')) {
      curExtInf = trimmed;
    } else if (curExtInf !== null) {
      if (/^https?:\/\//i.test(trimmed)) {
        const item = parseExtInf(curExtInf);
        if (item) {
          item.streamUrl = trimmed;
          items.push(item);
        }
        curExtInf = null;
      } else if (trimmed === '' || trimmed.startsWith('#EXTM3U') || trimmed.startsWith('#EXTVLCOPT')) {
        // skip
      } else if (trimmed.startsWith('#EXTINF:')) {
        curExtInf = trimmed;
      } else if (trimmed.startsWith('#')) {
        // skip other comments
      } else {
        curExtInf = curExtInf + ' ' + trimmed;
      }
    }
  }
  return items;
}

function parseExtInf(line: string): ParsedItem | null {
  const attrs: Record<string, string> = {};
  const attrRegex = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(line)) !== null) {
    attrs[m[1].toLowerCase()] = m[2].trim();
  }

  const tvgLogo = attrs['tvg-logo'] || '';
  const groupLogo = attrs['group-logo'] || '';
  const poster = tvgLogo || groupLogo || '';
  const group = attrs['group-title'] || '';

  // Strict parsing: only accept items from "VT 🎬 | Tamil Movies" group
  if (group !== "VT 🎬 | Tamil Movies") return null;

  let rawName = '';
  let lastQuoteIdx = -1;
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuote = !inQuote;
      if (!inQuote) lastQuoteIdx = i;
    }
  }
  if (lastQuoteIdx > -1) {
    const commaIdx = line.indexOf(',', lastQuoteIdx);
    if (commaIdx !== -1) rawName = line.substring(commaIdx + 1).trim();
  } else {
    const ci = line.lastIndexOf(',');
    if (ci !== -1) rawName = line.substring(ci + 1).trim();
  }

  const parsed = parseDisplayName(rawName);
  return { poster, group, streamUrl: '', ...parsed };
}

function parseDisplayName(name: string) {
  const result = {
    title: name || 'Unknown',
    year: null as number | null,
    genre: [] as string[],
    duration: null as string | null,
    director: null as string | null,
    stars: [] as string[],
    imdbRating: null as number | null,
    language: null as string | null,
  };
  if (!name) return result;

  const cleanName = name.replace(/^#+\s*/, '');

  const imdbMatch = name.match(/(?:IMDB|𝗜𝗠𝗗𝗕)\s*([\d.]+)/i);
  if (imdbMatch) result.imdbRating = parseFloat(imdbMatch[1]);

  const yearRegex = /\b((?:19|20)\d{2})\b/g;
  let ym;
  const movieYears: number[] = [];
  while ((ym = yearRegex.exec(name)) !== null) {
    const y = parseInt(ym[1], 10);
    if (y >= 1920 && y <= 2030) movieYears.push(y);
  }
  if (movieYears.length > 0) result.year = movieYears[0];

  const titleMatch = name.match(/^([^(]+?)(?:\s*\(|$)/);
  if (titleMatch && titleMatch[1].trim()) {
    let t = titleMatch[1].trim().replace(/^#+\s*/, '');
    if (t) result.title = t;
  } else {
    result.title = cleanName || name;
  }

  const genreMatch = name.match(/‧\s*([A-Za-z][A-Za-z\s\\/|,]+[A-Za-z])\s*‧/);
  if (genreMatch) {
    const genres = genreMatch[1].split(/[\\/|,]/).map(g => g.trim()).filter(Boolean);
    const knownLangs = ['Hindi','Tamil','Telugu','Malayalam','Kannada','Bengali','English','Korean','Japanese','Marathi','Punjabi','Gujarati','Urdu','Chinese','Spanish','French','German','Italian','Portuguese','Arabic','Turkish','Thai'];
    const filteredGenres: string[] = [];
    for (const g of genres) {
      if (knownLangs.some(l => l.toLowerCase() === g.toLowerCase())) {
        result.language = g;
      } else {
        filteredGenres.push(g);
      }
    }
    result.genre = filteredGenres.length > 0 ? filteredGenres : genres;
  }

  const durMatch = name.match(/(\d+h\s*\d*m?)/i);
  if (durMatch) result.duration = durMatch[1].trim();

  const dirMatch = name.match(/Directors?\s+([^|)]+)/i);
  if (dirMatch) result.director = dirMatch[1].trim().replace(/\s+/g, ' ').replace(/\s*(Writers?|Stars?).*$/i, '').trim();

  const starsMatch = name.match(/Stars?\s+(.+?)(?:\)|$)/i);
  if (starsMatch) {
    result.stars = starsMatch[1].split('‧').map(s => s.trim()).filter(Boolean);
    if (result.stars.length > 0) {
      result.stars[result.stars.length - 1] = result.stars[result.stars.length - 1].replace(/\)\s*$/, '').trim();
    }
    result.stars = result.stars.filter(Boolean);
  }

  return result;
}

function encodeConfig(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function App() {
  const [m3uUrl, setM3uUrl] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [tmdbKey, setTmdbKey] = useState('');
  const [showTmdb, setShowTmdb] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState('');
  const [addonUrl, setAddonUrl] = useState('');
  const [stremioUrl, setStremioUrl] = useState('');
  const [step, setStep] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'configure' | 'deploy' | 'format'>('configure');

  const toggleGroup = useCallback((idx: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleSelected = useCallback((name: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setAddonUrl('');
    setStremioUrl('');
  }, []);

  const selectAll = useCallback(() => {
    if (!scanResult) return;
    setSelectedGroups(new Set(scanResult.groups.map(g => g.name)));
    setAddonUrl(''); setStremioUrl('');
  }, [scanResult]);

  const selectNone = useCallback(() => {
    setSelectedGroups(new Set());
    setAddonUrl(''); setStremioUrl('');
  }, []);

  const getSelectedMovieCount = useCallback(() => {
    if (!scanResult) return 0;
    return scanResult.groups
      .filter(g => selectedGroups.has(g.name))
      .reduce((sum, g) => sum + g.count, 0);
  }, [scanResult, selectedGroups]);

  const doScan = async () => {
    if (!m3uUrl.trim()) return;
    setScanning(true);
    setScanError('');
    setScanResult(null);
    setAddonUrl('');
    setStremioUrl('');
    setSelectedGroups(new Set());
    setStep(2);

    try {
      let rawText = '';
      try {
        const resp = await fetch(m3uUrl.trim());
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        rawText = await resp.text();
      } catch {
        const proxies = [
          `https://api.allorigins.win/raw?url=${encodeURIComponent(m3uUrl.trim())}`,
          `https://corsproxy.io/?${encodeURIComponent(m3uUrl.trim())}`,
        ];
        for (const proxy of proxies) {
          try {
            const resp = await fetch(proxy);
            if (resp.ok) { rawText = await resp.text(); break; }
          } catch { /* try next */ }
        }
      }

      if (!rawText) {
        setScanError('Could not fetch the M3U URL. Make sure it is publicly accessible (raw GitHub URL).');
        setScanning(false);
        return;
      }

      const items = parseM3UClient(rawText);
      if (items.length === 0) {
        setScanError('No movies found. Make sure the file contains valid #EXTINF entries with http(s) stream URLs.');
        setScanning(false);
        return;
      }

      const groupMap: Record<string, ParsedItem[]> = {};
      for (const item of items) {
        const g = item.group || 'Uncategorized';
        if (!groupMap[g]) groupMap[g] = [];
        groupMap[g].push(item);
      }
      const groups: GroupInfo[] = Object.keys(groupMap).sort().map(name => ({
        name,
        count: groupMap[name].length,
        items: groupMap[name].sort((a, b) => {
          if (a.year && b.year && a.year !== b.year) return b.year - a.year;
          if (a.imdbRating && b.imdbRating) return b.imdbRating - a.imdbRating;
          return (a.title || '').localeCompare(b.title || '');
        }),
      }));

      const genreSet = new Set<string>();
      for (const item of items) {
        item.genre.forEach(g => genreSet.add(g));
        if (item.language) genreSet.add(item.language);
      }

      const withPoster = items.filter(it => !!it.poster).length;
      const rated = items.filter(it => it.imdbRating !== null);
      const avgRating = rated.length
        ? (rated.reduce((s, it) => s + (it.imdbRating || 0), 0) / rated.length).toFixed(1)
        : null;
      const years = items.map(it => it.year).filter((y): y is number => y !== null);

      setScanResult({
        total: items.length,
        groups,
        allGenres: Array.from(genreSet).sort(),
        withPoster,
        avgRating,
        minYear: years.length ? Math.min(...years) : null,
        maxYear: years.length ? Math.max(...years) : null,
      });
      // Select all groups by default
      setSelectedGroups(new Set(groups.map(g => g.name)));
      setStep(2);
    } catch (err: any) {
      setScanError(err.message || 'Unknown error');
    }
    setScanning(false);
  };

  const doGenerate = () => {
    const base = serverUrl.trim().replace(/\/+$/, '');
    if (!base) {
      setScanError('Please enter your deployed server URL first (expand "Server URL" section above).');
      setShowServer(true);
      return;
    }
    if (selectedGroups.size === 0) {
      setScanError('Please select at least one catalog group.');
      return;
    }
    setScanError('');
    const config: Record<string, unknown> = { m3uUrl: m3uUrl.trim() };
    if (tmdbKey.trim()) config.tmdbKey = tmdbKey.trim();
    config.groups = Array.from(selectedGroups);
    const encoded = encodeConfig(config);
    const manifest = `${base}/${encoded}/manifest.json`;
    const stremio = `stremio://${base.replace(/^https?:\/\//, '')}/${encoded}/manifest.json`;
    setAddonUrl(manifest);
    setStremioUrl(stremio);
    setStep(3);
  };

  const doCopy = () => {
    navigator.clipboard.writeText(addonUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const selectedCount = getSelectedMovieCount();

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-200">
      <div className="fixed top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-purple-500/[0.04] blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🎬</div>
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-purple-400 via-blue-400 to-emerald-400 bg-clip-text text-transparent">
            M3U Stremio Addon
          </h1>
          <p className="text-gray-500 text-sm mt-1">v3.0 · Enter M3U URL → Select catalogs → Install in Stremio</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 justify-center">
          {(['configure', 'deploy', 'format'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl font-semibold text-sm transition-all ${
                tab === t
                  ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                  : 'bg-white/5 text-gray-500 border border-transparent hover:bg-white/10'
              }`}
            >
              {t === 'configure' && '⚙️ Configure'}
              {t === 'deploy' && '🚀 Deploy'}
              {t === 'format' && '📄 M3U Format'}
            </button>
          ))}
        </div>

        {tab === 'configure' && (
          <>
            {/* Steps */}
            <div className="flex items-center justify-center gap-2 mb-6 flex-wrap text-xs">
              {[
                { n: 1, label: '① Enter URL' },
                { n: 2, label: '② Select Groups' },
                { n: 3, label: '③ Get Link' },
                { n: 4, label: '④ Install' },
              ].map((s, i) => (
                <span key={i} className="flex items-center gap-2">
                  <span className={`px-3 py-1.5 rounded-lg border transition-all ${
                    step > s.n ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                    step === s.n ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' :
                    'bg-[#111127] border-[#1e1e3a] text-gray-600'
                  }`}>{s.label}</span>
                  {i < 3 && <span className="text-gray-600">→</span>}
                </span>
              ))}
            </div>

            {/* M3U URL Input Card */}
            <div className="bg-[#111127] border border-[#1e1e3a] rounded-2xl overflow-hidden mb-5">
              <div className="p-4 border-b border-[#1e1e3a] bg-gradient-to-r from-purple-500/5 to-blue-500/5">
                <h2 className="text-base font-bold flex items-center gap-2">⚙️ Configure Your Source</h2>
                <p className="text-gray-500 text-xs mt-0.5">Paste your raw M3U URL, scan, then select which catalogs to include</p>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">
                    M3U Playlist URL <span className="text-red-400">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={m3uUrl}
                      onChange={e => { setM3uUrl(e.target.value); setScanResult(null); setAddonUrl(''); setStep(1); setSelectedGroups(new Set()); }}
                      onKeyDown={e => e.key === 'Enter' && doScan()}
                      placeholder="https://raw.githubusercontent.com/user/repo/main/playlist.m3u"
                      className="flex-1 px-3 py-2.5 bg-[#0a0a1a] border border-[#2a2a4a] rounded-xl text-sm text-gray-200 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/15 placeholder-gray-600 transition"
                    />
                    <button
                      onClick={doScan}
                      disabled={!m3uUrl.trim() || scanning}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold text-sm shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40 transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0 whitespace-nowrap flex items-center gap-2"
                    >
                      {scanning ? (
                        <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Scanning...</>
                      ) : (
                        <>🔍 Scan</>
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1">Raw GitHub URL to your .m3u file. Must be publicly accessible.</p>
                </div>

                {/* Server URL */}
                <button
                  onClick={() => setShowServer(!showServer)}
                  className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 font-semibold bg-transparent border-none cursor-pointer"
                >
                  🌐 Server URL
                  <span className="bg-blue-500/10 text-blue-400 border border-blue-500/15 px-1.5 py-0.5 rounded text-[9px]">Required for Install</span>
                  <span className="text-[10px]">{showServer ? '▲' : '▼'}</span>
                </button>
                {showServer && (
                  <div className="space-y-1.5">
                    <input
                      type="url"
                      value={serverUrl}
                      onChange={e => setServerUrl(e.target.value)}
                      placeholder="https://your-app.onrender.com"
                      className="w-full px-3 py-2.5 bg-[#0a0a1a] border border-[#2a2a4a] rounded-xl text-sm text-gray-200 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 placeholder-gray-600 font-mono transition"
                    />
                    <p className="text-[10px] text-gray-600">Your deployed server URL. See the Deploy tab for setup instructions.</p>
                  </div>
                )}

                {/* TMDB Key */}
                <button
                  onClick={() => setShowTmdb(!showTmdb)}
                  className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 font-semibold bg-transparent border-none cursor-pointer"
                >
                  🎬 TMDB API Key
                  <span className="bg-green-500/10 text-green-400 border border-green-500/15 px-1.5 py-0.5 rounded text-[9px]">Optional</span>
                  <span className="text-[10px]">{showTmdb ? '▲' : '▼'}</span>
                </button>
                {showTmdb && (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={tmdbKey}
                      onChange={e => setTmdbKey(e.target.value)}
                      placeholder="your-tmdb-api-key-here"
                      className="w-full px-3 py-2.5 bg-[#0a0a1a] border border-[#2a2a4a] rounded-xl text-sm text-gray-200 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/15 placeholder-gray-600 font-mono transition"
                    />
                    <p className="text-[10px] text-gray-600">
                      Auto-fetches missing posters & metadata.{' '}
                      <a href="https://www.themoviedb.org/settings/api" target="_blank" className="text-blue-400 hover:underline">Get free key →</a>
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Error */}
            {scanError && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/5 border border-red-500/15 text-red-400 mb-5 animate-[fadeIn_0.4s_ease]">
                <span className="text-lg">❌</span>
                <p className="text-sm">{scanError}</p>
              </div>
            )}

            {/* Scanning indicator */}
            {scanning && (
              <div className="text-center py-8">
                <div className="w-10 h-10 border-[3px] border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto" />
                <p className="text-gray-500 text-sm mt-4">Fetching & parsing M3U source...</p>
              </div>
            )}

            {/* Scan Results */}
            {scanResult && !scanning && (
              <div className="space-y-4 animate-[fadeIn_0.4s_ease]">
                {/* Hero count */}
                <div className="text-center py-6 bg-gradient-to-r from-purple-500/5 via-[#111127] to-blue-500/5 border border-purple-500/15 rounded-2xl">
                  <div className="text-6xl font-black bg-gradient-to-r from-purple-400 via-blue-400 to-emerald-400 bg-clip-text text-transparent leading-tight">
                    {scanResult.total.toLocaleString()}
                  </div>
                  <div className="text-gray-400 text-lg font-semibold mt-1">Total Movies Found</div>
                  <div className="text-gray-600 text-sm">{scanResult.groups.length} catalog{scanResult.groups.length !== 1 ? 's' : ''} detected</div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <StatCard icon="📂" value={scanResult.groups.length} label="Catalogs" color="text-blue-400" />
                  <StatCard icon="🎬" value={scanResult.total} label="Total" color="text-purple-400" />
                  <StatCard icon="🖼️" value={scanResult.withPoster} label="With Poster" color="text-green-400" />
                  {scanResult.avgRating && <StatCard icon="⭐" value={scanResult.avgRating} label="Avg Rating" color="text-yellow-400" />}
                  {scanResult.minYear && scanResult.maxYear && (
                    <StatCard icon="📅" value={`${scanResult.minYear}–${scanResult.maxYear}`} label="Year Range" color="text-orange-400" />
                  )}
                </div>

                {/* ═══ GROUP SELECTION ═══ */}
                <div className="bg-[#111127] border border-[#1e1e3a] rounded-2xl overflow-hidden">
                  <div className="p-4 border-b border-[#1e1e3a] bg-gradient-to-r from-purple-500/5 to-blue-500/5">
                    <h3 className="text-base font-bold flex items-center gap-2">☑️ Select Catalogs</h3>
                    <p className="text-[10px] text-gray-500 mt-0.5">Choose which group-titles to include in your Stremio addon</p>
                  </div>

                  {/* Select bar */}
                  <div className="flex items-center justify-between px-4 py-3 bg-purple-500/[0.03] border-b border-[#1e1e3a] flex-wrap gap-2">
                    <span className="text-sm font-bold text-purple-400">
                      {selectedGroups.size} of {scanResult.groups.length} selected ({selectedCount.toLocaleString()} movies)
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAll}
                        className="px-2.5 py-1 text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded hover:bg-purple-500/20 transition"
                      >
                        Select All
                      </button>
                      <button
                        onClick={selectNone}
                        className="px-2.5 py-1 text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded hover:bg-purple-500/20 transition"
                      >
                        Select None
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[500px] overflow-y-auto">
                    {scanResult.groups.map((grp, idx) => (
                      <div key={idx} className="border-b border-[#1e1e3a] last:border-b-0">
                        <div className="flex items-center gap-3 px-4 py-3 hover:bg-[#16162e] transition">
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={selectedGroups.has(grp.name)}
                            onChange={() => toggleSelected(grp.name)}
                            className="w-[18px] h-[18px] accent-purple-500 cursor-pointer flex-shrink-0"
                          />
                          {/* Toggle details button */}
                          <button
                            onClick={() => toggleGroup(idx)}
                            className="flex-1 flex items-center justify-between text-left bg-transparent border-none text-gray-200 cursor-pointer"
                          >
                            <span className="font-semibold text-sm flex items-center gap-2">
                              📁 {grp.name}
                            </span>
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              selectedGroups.has(grp.name)
                                ? 'bg-purple-500/15 text-purple-400'
                                : 'bg-gray-500/10 text-gray-500'
                            }`}>
                              {grp.count} movies
                            </span>
                          </button>
                        </div>
                        {expandedGroups.has(idx) && (
                          <div className="px-4 pb-3 pl-12 space-y-1.5">
                            <div className="text-[10px] text-gray-600 mb-2">Sample movies (showing up to 5):</div>
                            {grp.items.slice(0, 5).map((item, si) => (
                              <div key={si} className="flex items-center gap-2 py-1">
                                {item.poster ? (
                                  <img
                                    src={item.poster}
                                    alt=""
                                    className="w-7 h-10 object-cover rounded flex-shrink-0 bg-[#1e1e3a]"
                                    loading="lazy"
                                    onError={e => (e.currentTarget.style.display = 'none')}
                                  />
                                ) : (
                                  <div className="w-7 h-10 rounded bg-[#1e1e3a] flex items-center justify-center text-[8px] text-gray-600 flex-shrink-0">🎬</div>
                                )}
                                <span className="flex-1 text-xs text-gray-300 truncate">{item.title}</span>
                                {item.year && <span className="text-[10px] text-gray-600">{item.year}</span>}
                                {item.imdbRating && <span className="text-[10px] text-yellow-400">⭐ {item.imdbRating}</span>}
                              </div>
                            ))}
                            {grp.count > 5 && (
                              <div className="text-[10px] text-gray-600 pt-1">...and {grp.count - 5} more</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Selected summary */}
                <div className="text-center py-4 bg-purple-500/[0.03] border border-purple-500/10 rounded-xl">
                  <div className="text-4xl font-black bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent leading-tight">
                    {selectedCount.toLocaleString()}
                  </div>
                  <div className="text-gray-500 text-sm mt-1">
                    Movies in {selectedGroups.size} selected catalog{selectedGroups.size !== 1 ? 's' : ''}
                  </div>
                </div>

                {/* Generate button */}
                <div className="text-center py-4">
                  <button
                    onClick={doGenerate}
                    disabled={selectedGroups.size === 0}
                    className="px-8 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-base shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed disabled:hover:translate-y-0"
                  >
                    🚀 Generate Addon URL
                  </button>
                  <p className="text-[10px] text-gray-600 mt-2">Only your selected catalogs will appear in Stremio</p>
                  {!serverUrl.trim() && (
                    <p className="text-[10px] text-amber-400 mt-1">⚠️ Set your Server URL above first (expand "🌐 Server URL")</p>
                  )}
                </div>

                {/* Addon Result */}
                {addonUrl && (
                  <div className="bg-[#111127] border border-green-500/20 rounded-2xl overflow-hidden animate-[fadeIn_0.4s_ease]">
                    <div className="p-4 border-b border-green-500/20 bg-gradient-to-r from-green-500/5 to-emerald-500/5">
                      <h3 className="text-base font-bold flex items-center gap-2">🎉 Your Addon is Ready!</h3>
                      <p className="text-[10px] text-gray-500 mt-0.5">{selectedCount} movies from {selectedGroups.size} catalog{selectedGroups.size !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="p-5 space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1.5">Manifest URL</label>
                        <div className="flex items-center gap-2 bg-[#0a0a1a] p-3 rounded-xl border border-[#2a2a4a]">
                          <code className="flex-1 text-[11px] text-blue-400 break-all font-mono">{addonUrl}</code>
                          <button
                            onClick={doCopy}
                            className="px-3 py-1.5 text-[10px] rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 font-semibold hover:bg-purple-500/20 transition whitespace-nowrap"
                          >
                            {copied ? '✅ Copied!' : '📋 Copy'}
                          </button>
                        </div>
                      </div>
                      <a
                        href={stremioUrl}
                        onClick={() => setStep(4)}
                        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold text-base shadow-lg shadow-green-500/20 hover:shadow-green-500/40 transition-all hover:-translate-y-0.5 no-underline"
                      >
                        📥 Install in Stremio
                      </a>
                      <p className="text-center text-[10px] text-gray-600">Or paste the manifest URL in Stremio → Addons → Search bar</p>

                      {/* Show selected catalogs */}
                      <div className="bg-purple-500/[0.04] border border-purple-500/10 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-purple-400 mb-2">📂 Selected Catalogs:</h4>
                        {Array.from(selectedGroups).map(g => {
                          const grp = scanResult.groups.find(gr => gr.name === g);
                          return (
                            <div key={g} className="text-[11px] text-gray-400 py-0.5 flex items-center gap-2">
                              <span className="text-green-400">☑</span>
                              <span>{g}</span>
                              <span className="text-purple-400">({grp?.count || 0})</span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="bg-purple-500/5 border border-purple-500/10 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-purple-400 mb-1">💡 Change source or catalogs anytime</h4>
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          Come back here, enter a new M3U URL or select different catalogs, and generate a new addon URL.
                          Each configuration gets a unique URL — you can have multiple installed simultaneously!
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Deploy Tab */}
        {tab === 'deploy' && (
          <div className="space-y-5">
            <div className="bg-[#111127] border border-[#1e1e3a] rounded-2xl overflow-hidden">
              <div className="p-5 border-b border-[#1e1e3a] bg-gradient-to-r from-purple-500/5 to-blue-500/5">
                <h2 className="text-lg font-bold">🚀 Deploy to Render (Free Tier)</h2>
                <p className="text-gray-500 text-xs mt-1">Single-file server with embedded configure page</p>
              </div>
              <div className="p-5 space-y-6">
                <DeployStep n={1} title="Create a new GitHub repo">
                  <p className="text-gray-400 text-sm">e.g., <code className="text-blue-400">stremio-m3u-addon</code></p>
                </DeployStep>
                <DeployStep n={2} title="Add 2 files at the repo ROOT">
                  <div className="bg-[#0a0a1a] rounded-lg p-3 font-mono text-xs text-gray-400 border border-[#1e1e3a]">
                    <div className="text-blue-400">your-repo/</div>
                    <div className="ml-4">├── <span className="text-emerald-400 font-bold">server.js</span></div>
                    <div className="ml-4">└── <span className="text-emerald-400 font-bold">package.json</span></div>
                  </div>
                  <p className="text-yellow-400/70 text-[10px] mt-2 font-semibold">⚠️ Must be at ROOT — not inside any subfolder!</p>
                </DeployStep>
                <DeployStep n={3} title="Create Render Web Service">
                  <table className="w-full text-sm mt-2">
                    <tbody>
                      {[
                        ['Build Command', 'npm install'],
                        ['Start Command', 'node server.js'],
                        ['Root Directory', '(leave empty)'],
                        ['Instance Type', 'Free'],
                      ].map(([k, v]) => (
                        <tr key={k} className="border-b border-[#1e1e3a]">
                          <td className="py-2 pr-4 text-gray-500 font-medium">{k}</td>
                          <td className="py-2 font-mono text-blue-400">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DeployStep>
                <DeployStep n={4} title="Set Environment Variables (optional)">
                  <table className="w-full text-sm mt-2">
                    <tbody>
                      <tr className="border-b border-[#1e1e3a]">
                        <td className="py-2 pr-4 font-mono text-purple-400 text-xs">RENDER_EXTERNAL_URL</td>
                        <td className="py-2 text-gray-400 text-xs">Keep-alive pings</td>
                      </tr>
                      <tr className="border-b border-[#1e1e3a]">
                        <td className="py-2 pr-4 font-mono text-purple-400 text-xs">TMDB_API_KEY</td>
                        <td className="py-2 text-gray-400 text-xs">Fallback metadata</td>
                      </tr>
                    </tbody>
                  </table>
                </DeployStep>
                <DeployStep n={5} title="Visit /configure on your server">
                  <p className="text-gray-400 text-xs">
                    Go to <code className="text-blue-400">https://your-app.onrender.com/configure</code> —
                    enter your M3U URL, select catalogs, install!
                  </p>
                </DeployStep>
              </div>
            </div>
          </div>
        )}

        {/* Format Tab */}
        {tab === 'format' && (
          <div className="space-y-4">
            <div className="bg-[#111127] border border-[#1e1e3a] rounded-2xl overflow-hidden">
              <div className="p-5 border-b border-[#1e1e3a] bg-gradient-to-r from-purple-500/5 to-blue-500/5">
                <h2 className="text-lg font-bold">📄 Supported M3U Format</h2>
              </div>
              <div className="p-5 space-y-4">
                <pre className="bg-[#0a0a1a] rounded-lg p-4 font-mono text-[10px] text-gray-400 border border-[#1e1e3a] overflow-x-auto whitespace-pre leading-relaxed">{`#EXTM3U

# Simple entry:
#EXTINF:-1 group-title="VT 🎬 | Tamil Movies" tvg-logo="poster.jpg" ,#AAY
https://example.com/aay.mkv

# Full entry (multi-line supported):
#EXTINF:-1 type="movie" group-logo="poster.jpg"
  group-title="VT 🎬 | Tamil Movies",Movie Name (𝗜𝗠𝗗𝗕 8.0
  2026 ‧ Adventure\\Action\\Drama ‧ 2h 27m ‧ Director Name
  | Writers Name | Stars Actor1 ‧ Actor2 ‧ Actor3)
https://example.com/movie.mkv`}</pre>

                <h3 className="font-bold text-sm text-purple-400">Parsed Fields</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    ['group-title', 'Used for catalog grouping — you can select which ones to include'],
                    ['Poster', 'tvg-logo OR group-logo (whichever has value)'],
                    ['Title', 'Text after last comma, before first ('],
                    ['IMDB Rating', 'IMDB or 𝗜𝗠𝗗𝗕 + number'],
                    ['Year', 'First 4-digit year (1920–2030)'],
                    ['Genres', 'Between ‧ markers, split by \\ or /'],
                    ['Duration', 'Pattern like "2h 27m"'],
                    ['Director', 'After "Director" keyword'],
                    ['Stars', 'After "Stars", split by ‧'],
                    ['Multi-line', 'Non-URL lines merged into EXTINF'],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-[#0a0a1a] rounded-lg p-2.5 border border-[#1e1e3a]">
                      <span className="text-emerald-400 font-bold text-[10px]">{k}:</span>
                      <span className="text-gray-500 text-[10px] ml-1.5">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="text-center mt-10 text-gray-600 text-[10px]">
          M3U Stremio Addon v3.0 · Select specific catalogs · Client-side scanning
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color: string }) {
  return (
    <div className="bg-[#0a0a1a] p-3 rounded-xl border border-[#1e1e3a] text-center">
      <div className="text-lg mb-1">{icon}</div>
      <div className={`text-xl font-extrabold ${color}`}>{value}</div>
      <div className="text-[9px] text-gray-600 mt-0.5">{label}</div>
    </div>
  );
}

function DeployStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-500/15 text-purple-400 flex items-center justify-center font-bold text-xs border border-purple-500/30">
        {n}
      </div>
      <div className="flex-1">
        <h3 className="font-bold text-sm mb-1">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default App;
