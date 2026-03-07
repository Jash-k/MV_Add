import { useState, useCallback, useRef, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────
interface ParsedItem {
  title: string;
  year: number | null;
  group: string;
  genre: string[];
  imdbRating: number | null;
  duration: string | null;
  director: string | null;
  stars: string[];
  poster: string;
  streamUrl: string;
  language: string | null;
  rawName: string;
}

interface GroupInfo {
  name: string;
  count: number;
  genres: string[];
  topRated: ParsedItem | null;
  latest: ParsedItem | null;
}

interface ParseResult {
  totalItems: number;
  groups: GroupInfo[];
  allGenres: string[];
  yearRange: [number, number] | null;
  avgRating: number | null;
  withPoster: number;
  withRating: number;
  items: ParsedItem[];
}

// ─── Client-side M3U Parser ─────────────────────────────────
function parseM3U(raw: string): ParsedItem[] {
  const lines = raw.split(/\r?\n/);
  const items: ParsedItem[] = [];
  let cur: Partial<ParsedItem> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("#EXTINF:")) {
      cur = parseExtInf(line);
    } else if (line && !line.startsWith("#") && cur) {
      cur.streamUrl = line;
      items.push(cur as ParsedItem);
      cur = null;
    }
  }
  return items;
}

function parseExtInf(line: string): Partial<ParsedItem> {
  const getAttr = (key: string) => {
    const m = line.match(new RegExp(key + '="([^"]*)"', "i"));
    return m ? m[1].trim() : "";
  };

  const tvgLogo = getAttr("tvg-logo");
  const group = getAttr("group-title") || "Uncategorized";

  const ci = line.lastIndexOf(",");
  const rawName = ci !== -1 ? line.substring(ci + 1).trim() : "";

  const parsed = parseDisplayName(rawName);

  return {
    ...parsed,
    group,
    poster: tvgLogo,
    rawName,
  };
}

function parseDisplayName(name: string) {
  const d: {
    title: string;
    year: number | null;
    genre: string[];
    duration: string | null;
    director: string | null;
    stars: string[];
    imdbRating: number | null;
    language: string | null;
  } = {
    title: name,
    year: null,
    genre: [],
    duration: null,
    director: null,
    stars: [],
    imdbRating: null,
    language: null,
  };
  if (!name) return d;

  // IMDB rating
  const imdbM = name.match(/IMD[B]\s*([\d.]+)/i) || name.match(/\u{1D5DC}\u{1D5E0}\u{1D5D7}\u{1D5D5}\s*([\d.]+)/u) || name.match(/IMDB\s*([\d.]+)/i);
  if (!imdbM) {
    // Try matching bold unicode IMDB variants
    const altMatch = name.match(/[I\u{1D5DC}][M\u{1D5E0}][D\u{1D5D7}][B\u{1D5D5}]\s*([\d.]+)/iu);
    if (altMatch) d.imdbRating = parseFloat(altMatch[1]);
  } else {
    d.imdbRating = parseFloat(imdbM[1]);
  }

  // Year
  const years = [...name.matchAll(/\b((?:19|20)\d{2})\b/g)];
  if (years.length) d.year = parseInt(years[0][1], 10);

  // Title: text before first "("
  const tM = name.match(/^([^(]*?)(?:\s*\(|$)/);
  if (tM && tM[1].trim()) d.title = tM[1].trim();

  // Genres from ‧-delimited section
  const gM = name.match(/‧\s*([\w\s\\/|]+(?:\s*[\w\s\\/|]+)*)\s*‧/);
  if (gM) {
    d.genre = gM[1]
      .split(/[\\/|]/)
      .map((g) => g.trim())
      .filter(Boolean);
    const langs = [
      "Hindi", "Tamil", "Telugu", "Malayalam", "Kannada", "Bengali",
      "English", "Korean", "Japanese", "Marathi", "Punjabi", "Gujarati",
      "Urdu", "Chinese", "Spanish", "French", "German", "Italian",
    ];
    const last = d.genre[d.genre.length - 1];
    if (last && langs.some((l) => l.toLowerCase() === last.toLowerCase()))
      d.language = last;
  }

  // Duration
  const durM = name.match(/(\d+h\s*\d*m?)/i);
  if (durM) d.duration = durM[1];

  // Director
  const dirM = name.match(/Directors?\s+([^|)]+)/i);
  if (dirM) d.director = dirM[1].trim().replace(/\s+/g, " ");

  // Stars
  const staM = name.match(/Stars?\s+(.+?)(?:\)|$)/i);
  if (staM) d.stars = staM[1].split("‧").map((s) => s.trim()).filter(Boolean);

  return d;
}

function analyzeItems(items: ParsedItem[]): ParseResult {
  const groupMap: Record<string, ParsedItem[]> = {};
  const allGenreSet = new Set<string>();
  let minYear = Infinity, maxYear = -Infinity;
  let ratingSum = 0, ratingCount = 0;
  let withPoster = 0, withRating = 0;

  for (const item of items) {
    const g = item.group || "Uncategorized";
    if (!groupMap[g]) groupMap[g] = [];
    groupMap[g].push(item);
    item.genre?.forEach((gen) => allGenreSet.add(gen));
    if (item.language) allGenreSet.add(item.language);
    if (item.year) {
      if (item.year < minYear) minYear = item.year;
      if (item.year > maxYear) maxYear = item.year;
    }
    if (item.imdbRating) {
      ratingSum += item.imdbRating;
      ratingCount++;
      withRating++;
    }
    if (item.poster) withPoster++;
  }

  const groups: GroupInfo[] = Object.entries(groupMap)
    .map(([name, gItems]) => {
      const genreSet = new Set<string>();
      gItems.forEach((i) => {
        i.genre?.forEach((g) => genreSet.add(g));
        if (i.language) genreSet.add(i.language);
      });
      const sorted = [...gItems].sort(
        (a, b) => (b.imdbRating || 0) - (a.imdbRating || 0)
      );
      const latestSorted = [...gItems].sort(
        (a, b) => (b.year || 0) - (a.year || 0)
      );
      return {
        name,
        count: gItems.length,
        genres: [...genreSet].sort(),
        topRated: sorted[0] || null,
        latest: latestSorted[0] || null,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    totalItems: items.length,
    groups,
    allGenres: [...allGenreSet].sort(),
    yearRange:
      minYear !== Infinity ? [minYear, maxYear] : null,
    avgRating: ratingCount > 0 ? parseFloat((ratingSum / ratingCount).toFixed(1)) : null,
    withPoster,
    withRating,
    items,
  };
}

// ─── Config Encoder ──────────────────────────────────────────
function encodeConfig(obj: Record<string, string>): string {
  const json = JSON.stringify(obj);
  return btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getCurrentHost(): string {
  return window.location.origin;
}

// ─── Copy Button ─────────────────────────────────────────────
function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 rounded-lg text-xs font-medium transition-all text-purple-300 border border-purple-500/30 hover:border-purple-500/60 cursor-pointer"
    >
      {copied ? "✅ Copied!" : label}
    </button>
  );
}

// ─── Stat Card ───────────────────────────────────────────────
function StatCard({
  icon,
  value,
  label,
  color,
}: {
  icon: string;
  value: string | number;
  label: string;
  color: string;
}) {
  return (
    <div className="bg-[#0a0a1a] p-4 rounded-xl border border-[#1e1e3a] text-center min-w-[90px] flex-1">
      <div className="text-xl mb-1">{icon}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────
export default function App() {
  const [m3uUrl, setM3uUrl] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [showTmdb, setShowTmdb] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [configGenerated, setConfigGenerated] = useState(false);
  const [manifestUrl, setManifestUrl] = useState("");
  const [stremioUrl, setStremioUrl] = useState("");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"install" | "deploy" | "api">("install");
  const [searchFilter, setSearchFilter] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  const addonRef = useRef<HTMLDivElement>(null);

  // Reset on URL change
  useEffect(() => {
    setParseResult(null);
    setParseError(null);
    setConfigGenerated(false);
  }, [m3uUrl]);

  // Fetch and parse M3U client-side
  const fetchAndParse = useCallback(async () => {
    if (!m3uUrl.trim()) return;
    setLoading(true);
    setParseError(null);
    setParseResult(null);
    setConfigGenerated(false);

    try {
      const resp = await fetch(m3uUrl.trim());
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const text = await resp.text();

      if (!text.includes("#EXTINF")) {
        throw new Error(
          "Invalid M3U file — no #EXTINF entries found. Make sure the URL points to a valid .m3u file."
        );
      }

      const items = parseM3U(text);
      if (items.length === 0) {
        throw new Error("M3U parsed but 0 items found. Check the file format.");
      }

      const result = analyzeItems(items);
      setParseResult(result);

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setParseError(
          "CORS error — can't fetch this URL from the browser. This is normal for some URLs. " +
            "The server will fetch it directly. You can still generate the addon URL below."
        );
        // Allow generating addon URL even with CORS error
        setParseResult({
          totalItems: -1,
          groups: [],
          allGenres: [],
          yearRange: null,
          avgRating: null,
          withPoster: 0,
          withRating: 0,
          items: [],
        });
      } else {
        setParseError(msg);
      }
    }
    setLoading(false);
  }, [m3uUrl]);

  // Generate addon URL
  const generateAddon = useCallback(() => {
    const config: Record<string, string> = { m3uUrl: m3uUrl.trim() };
    if (tmdbKey.trim()) config.tmdbKey = tmdbKey.trim();

    const encoded = encodeConfig(config);
    const base = getCurrentHost();

    setManifestUrl(`${base}/${encoded}/manifest.json`);
    setStremioUrl(
      `stremio://${base.replace(/^https?:\/\//, "")}/${encoded}/manifest.json`
    );
    setConfigGenerated(true);

    setTimeout(() => {
      addonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  }, [m3uUrl, tmdbKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAndParse();
  };

  const filteredGroups =
    parseResult?.groups.filter((g) =>
      g.name.toLowerCase().includes(searchFilter.toLowerCase())
    ) || [];

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-200">
      {/* BG Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-purple-600/5 blur-[120px]" />
        <div className="absolute bottom-[-300px] right-[-200px] w-[600px] h-[600px] rounded-full bg-blue-600/5 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 sm:py-16">
        {/* ── Header ── */}
        <header className="text-center mb-12">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="text-5xl float-animation">🎬</div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold gradient-text">
                M3U Stremio Addon
              </h1>
              <p className="text-gray-500 text-sm mt-1">
                v3.0 · User-Configurable · No Redeploy Needed
              </p>
            </div>
          </div>
          <p className="text-gray-400 max-w-lg mx-auto mt-3">
            Enter your M3U playlist URL below to see what's inside, then
            generate your personalized Stremio addon URL.
          </p>
        </header>

        {/* ── Flow Steps ── */}
        <div className="flex items-center justify-center gap-1 sm:gap-3 text-xs sm:text-sm mb-12 flex-wrap">
          {[
            { icon: "📝", label: "Enter URL", active: !!m3uUrl },
            { icon: "🔍", label: "Scan Source", active: !!parseResult },
            { icon: "🔗", label: "Get Addon Link", active: configGenerated },
            { icon: "🍿", label: "Watch!", active: false },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-1 sm:gap-3">
              <div
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all ${
                  step.active
                    ? "bg-purple-600/15 border-purple-500/40 text-purple-300"
                    : "bg-[#111127] border-[#1e1e3a] text-gray-500"
                }`}
              >
                <span>{step.icon}</span>
                <span>{step.label}</span>
              </div>
              {i < 3 && (
                <span
                  className={`font-bold ${
                    step.active ? "text-purple-500" : "text-gray-700"
                  }`}
                >
                  →
                </span>
              )}
            </div>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════ */}
        {/*  CONFIGURATION FORM                               */}
        {/* ══════════════════════════════════════════════════ */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="bg-[#111127] rounded-2xl border border-[#1e1e3a] overflow-hidden shadow-2xl shadow-purple-900/10">
            <div className="px-6 py-4 bg-gradient-to-r from-purple-600/10 to-blue-600/10 border-b border-[#1e1e3a]">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                Configure Your Source
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Paste your raw M3U URL and we'll scan it instantly
              </p>
            </div>

            <div className="p-6 space-y-5">
              {/* M3U URL Input */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  M3U Playlist URL <span className="text-red-400">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={m3uUrl}
                    onChange={(e) => setM3uUrl(e.target.value)}
                    placeholder="https://raw.githubusercontent.com/user/repo/main/playlist.m3u"
                    required
                    className="flex-1 px-4 py-3 bg-[#0a0a1a] border border-[#2a2a4a] rounded-xl text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 transition-all text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!m3uUrl.trim() || loading}
                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-lg shadow-purple-600/20 hover:shadow-purple-600/40 disabled:shadow-none flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    {loading ? (
                      <>
                        <svg
                          className="animate-spin w-5 h-5"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="3"
                            className="opacity-25"
                          />
                          <path
                            d="M4 12a8 8 0 018-8"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            className="opacity-75"
                          />
                        </svg>
                        Scanning...
                      </>
                    ) : (
                      <>🔍 Scan Source</>
                    )}
                  </button>
                </div>
                <p className="text-gray-600 text-xs mt-1.5">
                  Raw GitHub URL to your .m3u file. Must be publicly accessible.
                </p>
              </div>

              {/* TMDB Key (Optional) */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowTmdb(!showTmdb)}
                  className="text-sm font-medium text-gray-400 hover:text-gray-200 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  TMDB API Key
                  <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full border border-green-500/20">
                    Optional
                  </span>
                  <svg
                    className={`w-4 h-4 transition-transform ${showTmdb ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {showTmdb && (
                  <div className="mt-2 animate-fadeIn">
                    <input
                      type="text"
                      value={tmdbKey}
                      onChange={(e) => setTmdbKey(e.target.value)}
                      placeholder="your-tmdb-api-key-here"
                      className="w-full px-4 py-3 bg-[#0a0a1a] border border-[#2a2a4a] rounded-xl text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 transition-all text-sm font-mono"
                    />
                    <p className="text-gray-600 text-xs mt-1.5">
                      Fills in missing posters, descriptions & genres.{" "}
                      <a
                        href="https://www.themoviedb.org/settings/api"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        Get free key →
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>

        {/* ══════════════════════════════════════════════════ */}
        {/*  PARSE ERROR                                      */}
        {/* ══════════════════════════════════════════════════ */}
        {parseError && !parseResult && (
          <div className="mb-8 bg-red-500/5 border border-red-500/20 rounded-2xl p-6 animate-fadeIn">
            <h3 className="text-red-400 font-semibold flex items-center gap-2 mb-2">
              <span className="text-xl">❌</span> Error Scanning Source
            </h3>
            <p className="text-gray-400 text-sm">{parseError}</p>
          </div>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/*  SCAN RESULTS — MOVIE COUNT & STATS               */}
        {/* ══════════════════════════════════════════════════ */}
        {parseResult && (
          <div ref={resultRef} className="space-y-6 animate-fadeIn">
            {/* CORS warning with fallback */}
            {parseError && parseResult.totalItems === -1 && (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-5">
                <h3 className="text-yellow-400 font-semibold flex items-center gap-2 mb-2">
                  <span className="text-xl">⚠️</span> CORS Restriction
                </h3>
                <p className="text-gray-400 text-sm mb-3">{parseError}</p>
                <button
                  onClick={generateAddon}
                  className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold rounded-xl transition-all cursor-pointer text-sm"
                >
                  🔗 Generate Addon URL Anyway
                </button>
              </div>
            )}

            {/* Stats Cards - MAIN FEATURE */}
            {parseResult.totalItems > 0 && (
              <>
                {/* Big Hero Count */}
                <div className="bg-gradient-to-br from-purple-600/10 via-[#111127] to-blue-600/10 rounded-2xl border border-purple-500/20 p-8 text-center">
                  <div className="text-6xl sm:text-7xl font-black gradient-text mb-2">
                    {parseResult.totalItems.toLocaleString()}
                  </div>
                  <div className="text-gray-400 text-lg">
                    Movies Found
                  </div>
                  <div className="text-gray-600 text-sm mt-1">
                    in {parseResult.groups.length} catalog
                    {parseResult.groups.length !== 1 ? "s" : ""}
                  </div>
                </div>

                {/* Detail Stats Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard
                    icon="📂"
                    value={parseResult.groups.length}
                    label="Catalogs"
                    color="text-blue-400"
                  />
                  <StatCard
                    icon="🖼️"
                    value={parseResult.withPoster}
                    label="With Poster"
                    color="text-green-400"
                  />
                  <StatCard
                    icon="⭐"
                    value={
                      parseResult.avgRating
                        ? parseResult.avgRating.toString()
                        : "—"
                    }
                    label="Avg Rating"
                    color="text-yellow-400"
                  />
                  <StatCard
                    icon="📅"
                    value={
                      parseResult.yearRange
                        ? `${parseResult.yearRange[0]}–${parseResult.yearRange[1]}`
                        : "—"
                    }
                    label="Year Range"
                    color="text-purple-400"
                  />
                </div>

                {/* Missing Data Warning */}
                {parseResult.withPoster < parseResult.totalItems * 0.5 && (
                  <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 flex items-start gap-3">
                    <span className="text-xl shrink-0">💡</span>
                    <div>
                      <p className="text-yellow-300 text-sm font-medium">
                        {parseResult.totalItems - parseResult.withPoster} movies
                        missing posters
                      </p>
                      <p className="text-gray-500 text-xs mt-1">
                        Add a TMDB API key above to automatically fetch missing
                        posters, descriptions, and genre data.
                      </p>
                    </div>
                  </div>
                )}

                {/* Genre Cloud */}
                {parseResult.allGenres.length > 0 && (
                  <div className="bg-[#111127] rounded-2xl border border-[#1e1e3a] p-6">
                    <h3 className="font-semibold text-sm text-gray-300 mb-3 flex items-center gap-2">
                      <span>🎭</span> Genres Found ({parseResult.allGenres.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {parseResult.allGenres.map((g) => (
                        <span
                          key={g}
                          className="px-3 py-1.5 bg-[#0a0a1a] rounded-full text-xs border border-[#1e1e3a] text-gray-400 hover:border-purple-500/30 transition-all"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Catalogs Breakdown */}
                <div className="bg-[#111127] rounded-2xl border border-[#1e1e3a] overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#1e1e3a] flex items-center justify-between flex-wrap gap-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <span className="text-xl">📂</span>
                      Catalog Breakdown
                      <span className="text-xs text-gray-500 font-normal">
                        ({parseResult.groups.length} groups)
                      </span>
                    </h3>
                    {parseResult.groups.length > 5 && (
                      <input
                        type="text"
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                        placeholder="Filter catalogs..."
                        className="px-3 py-1.5 bg-[#0a0a1a] border border-[#2a2a4a] rounded-lg text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500 w-full sm:w-48"
                      />
                    )}
                  </div>

                  <div className="divide-y divide-[#1e1e3a] max-h-[600px] overflow-y-auto">
                    {filteredGroups.map((group) => (
                      <div key={group.name}>
                        <button
                          onClick={() =>
                            setExpandedGroup(
                              expandedGroup === group.name
                                ? null
                                : group.name
                            )
                          }
                          className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#16162e] transition-all cursor-pointer text-left"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-lg shrink-0">📁</span>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-200 truncate">
                                {group.name}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {group.genres.length > 0
                                  ? group.genres.slice(0, 4).join(", ")
                                  : "No genres detected"}
                                {group.genres.length > 4 &&
                                  ` +${group.genres.length - 4} more`}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="bg-purple-600/20 text-purple-300 px-3 py-1 rounded-full text-sm font-bold">
                              {group.count}
                            </div>
                            <svg
                              className={`w-4 h-4 text-gray-500 transition-transform ${
                                expandedGroup === group.name
                                  ? "rotate-180"
                                  : ""
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </div>
                        </button>

                        {expandedGroup === group.name && (
                          <div className="px-6 pb-4 animate-fadeIn">
                            <div className="bg-[#0a0a1a] rounded-xl p-4 border border-[#1e1e3a] space-y-3">
                              {/* Group stats */}
                              <div className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <span className="text-gray-500">
                                    Movies:{" "}
                                  </span>
                                  <span className="text-purple-400 font-bold">
                                    {group.count}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500">
                                    Genres:{" "}
                                  </span>
                                  <span className="text-blue-400">
                                    {group.genres.length}
                                  </span>
                                </div>
                                {group.topRated?.imdbRating && (
                                  <div>
                                    <span className="text-gray-500">
                                      Top Rated:{" "}
                                    </span>
                                    <span className="text-yellow-400">
                                      ⭐ {group.topRated.imdbRating} —{" "}
                                      {group.topRated.title}
                                    </span>
                                  </div>
                                )}
                                {group.latest?.year && (
                                  <div>
                                    <span className="text-gray-500">
                                      Latest:{" "}
                                    </span>
                                    <span className="text-green-400">
                                      {group.latest.year} —{" "}
                                      {group.latest.title}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Genre pills */}
                              {group.genres.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {group.genres.map((g) => (
                                    <span
                                      key={g}
                                      className="px-2 py-1 bg-[#111127] rounded text-xs text-gray-400 border border-[#1e1e3a]"
                                    >
                                      {g}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Sample movies */}
                              <div>
                                <div className="text-xs text-gray-500 mb-2">
                                  Sample movies:
                                </div>
                                <div className="space-y-1">
                                  {parseResult!.items
                                    .filter((i) => i.group === group.name)
                                    .slice(0, 5)
                                    .map((item, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center gap-2 text-xs"
                                      >
                                        {item.poster ? (
                                          <img
                                            src={item.poster}
                                            alt=""
                                            className="w-6 h-9 object-cover rounded shrink-0"
                                            onError={(e) => {
                                              (
                                                e.target as HTMLImageElement
                                              ).style.display = "none";
                                            }}
                                          />
                                        ) : (
                                          <div className="w-6 h-9 bg-[#111127] rounded flex items-center justify-center text-gray-700 shrink-0">
                                            🎬
                                          </div>
                                        )}
                                        <span className="text-gray-300 truncate">
                                          {item.title}
                                        </span>
                                        {item.year && (
                                          <span className="text-gray-600 shrink-0">
                                            ({item.year})
                                          </span>
                                        )}
                                        {item.imdbRating && (
                                          <span className="text-yellow-500 shrink-0">
                                            ⭐{item.imdbRating}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* GENERATE ADDON URL BUTTON */}
                <div className="text-center">
                  <button
                    onClick={generateAddon}
                    className="w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-600/20 hover:shadow-purple-600/40 text-lg glow-pulse cursor-pointer"
                  >
                    🚀 Generate Addon URL
                  </button>
                  <p className="text-gray-600 text-xs mt-2">
                    Your config is encoded in the URL — no data stored on server
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/*  ADDON INSTALL CARD                               */}
        {/* ══════════════════════════════════════════════════ */}
        {configGenerated && (
          <div ref={addonRef} className="mt-8 space-y-6 animate-fadeIn">
            <div className="bg-[#111127] rounded-2xl border border-green-500/20 overflow-hidden shadow-2xl shadow-green-900/10">
              <div className="px-6 py-4 bg-gradient-to-r from-green-600/10 to-emerald-600/10 border-b border-green-500/20">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <span className="text-xl">🎉</span>
                  Your Addon is Ready!
                  {parseResult && parseResult.totalItems > 0 && (
                    <span className="text-sm font-normal text-green-400 ml-1">
                      — {parseResult.totalItems.toLocaleString()} movies
                    </span>
                  )}
                </h3>
              </div>

              <div className="p-6 space-y-5">
                {/* Manifest URL */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2 block">
                    Manifest URL
                  </label>
                  <div className="flex items-center gap-2 bg-[#0a0a1a] p-3 rounded-xl border border-[#2a2a4a]">
                    <code className="text-sm text-blue-400 break-all flex-1 select-all">
                      {manifestUrl}
                    </code>
                    <CopyButton text={manifestUrl} />
                  </div>
                </div>

                {/* Install Button */}
                <a
                  href={stremioUrl}
                  className="block w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold rounded-xl text-center transition-all shadow-lg shadow-green-600/20 hover:shadow-green-600/40 text-lg"
                >
                  📥 Install in Stremio
                </a>

                {/* Info */}
                <div className="text-center text-gray-600 text-xs">
                  Or paste the manifest URL in Stremio → Addons → Search box
                </div>

                <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 text-sm">
                  <p className="text-purple-300 font-medium mb-1">
                    💡 Want to change source later?
                  </p>
                  <p className="text-gray-400 text-xs">
                    Just come back here, enter a new M3U URL, scan it, and
                    install the new addon URL. Each source gets its own unique
                    URL — you can have multiple sources installed simultaneously!
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/*  FEATURES                                         */}
        {/* ══════════════════════════════════════════════════ */}
        <section className="mt-16 mb-12">
          <h2 className="text-xl font-bold text-center mb-8 gradient-text">
            Features
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: "🔄",
                title: "Source in URL",
                desc: "M3U URL is encoded in your addon link. Change sources without redeploying.",
              },
              {
                icon: "🔍",
                title: "Live Source Scan",
                desc: "See total movies, catalogs, genres, and sample data before installing.",
              },
              {
                icon: "🎭",
                title: "Sort & Filter",
                desc: "Catalogs sorted by year & IMDB rating. Filter by genre in Stremio's UI.",
              },
              {
                icon: "🎬",
                title: "TMDB Fallback",
                desc: "Missing poster or info? TMDB fills in the gaps automatically.",
              },
              {
                icon: "⏰",
                title: "Auto-Refresh 6h",
                desc: "M3U source re-fetched every 6 hours. Always up-to-date content.",
              },
              {
                icon: "💓",
                title: "Keep-Alive",
                desc: "Self-pings every 10 min to prevent Render free tier spin-down.",
              },
            ].map((f, i) => (
              <div
                key={i}
                className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-5 hover:border-purple-500/30 transition-all group"
              >
                <div className="text-2xl mb-2 group-hover:scale-110 transition-transform inline-block">
                  {f.icon}
                </div>
                <h3 className="font-semibold text-sm text-gray-200 mb-1">
                  {f.title}
                </h3>
                <p className="text-gray-500 text-xs leading-relaxed">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════ */}
        {/*  TABS                                             */}
        {/* ══════════════════════════════════════════════════ */}
        <section className="mb-16">
          <div className="flex border-b border-[#1e1e3a] mb-6">
            {(["install", "deploy", "api"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-3 text-sm font-medium transition-all border-b-2 cursor-pointer ${
                  activeTab === tab
                    ? "border-purple-500 text-purple-400"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab === "install" && "📥 Install Guide"}
                {tab === "deploy" && "🚀 Deploy Server"}
                {tab === "api" && "📡 API Reference"}
              </button>
            ))}
          </div>

          {activeTab === "install" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <span>📋</span> How to Install
                </h3>
                <ol className="space-y-4 text-sm text-gray-400">
                  {[
                    "Enter your raw GitHub M3U URL in the form above",
                    'Click "Scan Source" to see how many movies and catalogs are available',
                    "Optionally add your TMDB API key for enhanced metadata",
                    'Click "Generate Addon URL" to create your personalized addon link',
                    'Click "Install in Stremio" — it opens Stremio automatically',
                    "Your catalogs appear in Stremio's Discover tab with sort & filter",
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="text-purple-400 font-bold shrink-0">
                        {i + 1}.
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <span>📺</span> Expected M3U Format
                </h3>
                <div className="bg-[#0a0a1a] rounded-lg p-4 overflow-x-auto border border-[#1e1e3a]">
                  <pre className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">
                    {`#EXTM3U

#EXTINF:-1 type="movie" tvg-logo="https://poster.jpg" group-title="VT 🎬 | Tamil Movies",Movie Title (𝗜𝗠𝗗𝗕 7.5 2024 ‧ Action\\Drama\\Tamil ‧ 2h 30m Director Name | Stars Actor1 ‧ Actor2)
https://stream-url.mkv`}
                  </pre>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
                  <div>
                    <span className="text-purple-400">group-title</span> →
                    Catalog name
                  </div>
                  <div>
                    <span className="text-purple-400">tvg-logo</span> → Poster
                    image
                  </div>
                  <div>
                    <span className="text-purple-400">𝗜𝗠𝗗𝗕 7.5</span> → IMDB
                    rating
                  </div>
                  <div>
                    <span className="text-purple-400">2024</span> → Year (sorted
                    desc)
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "deploy" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 text-sm text-yellow-300">
                ⚠️ This page is the <strong>configure UI</strong>. You need to
                deploy the <strong>server</strong> separately on Render.
              </div>

              <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <span>🚀</span> Deploy to Render (Free Tier)
                </h3>
                <ol className="space-y-5 text-sm text-gray-400">
                  <li className="flex gap-3">
                    <span className="bg-purple-600/20 text-purple-400 w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold">
                      1
                    </span>
                    <div>
                      <strong className="text-gray-200 block mb-1">
                        Create GitHub repo with 2 files at root:
                      </strong>
                      <div className="bg-[#0a0a1a] rounded-lg p-3 border border-[#1e1e3a] font-mono text-xs">
                        <div className="text-gray-500">your-repo/</div>
                        <div className="text-green-400 ml-3">
                          ├── server.js
                        </div>
                        <div className="text-green-400 ml-3">
                          └── package.json
                        </div>
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="bg-purple-600/20 text-purple-400 w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold">
                      2
                    </span>
                    <div>
                      <strong className="text-gray-200 block mb-1">
                        Render Web Service settings:
                      </strong>
                      <table className="w-full text-xs mt-2">
                        <tbody>
                          {[
                            ["Runtime", "Node"],
                            ["Build Command", "npm install"],
                            ["Start Command", "node server.js"],
                            ["Root Directory", "(leave empty)"],
                            ["Instance Type", "Free"],
                          ].map(([k, v]) => (
                            <tr
                              key={k}
                              className="border-b border-[#1e1e3a]"
                            >
                              <td className="py-2 pr-4 text-gray-500 font-medium">
                                {k}
                              </td>
                              <td className="py-2 text-blue-400 font-mono">
                                {v}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="bg-purple-600/20 text-purple-400 w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold">
                      3
                    </span>
                    <div>
                      <strong className="text-gray-200 block mb-1">
                        Set env vars:
                      </strong>
                      <table className="w-full text-xs mt-2">
                        <tbody>
                          {[
                            [
                              "RENDER_EXTERNAL_URL",
                              "Required*",
                              "Your .onrender.com URL",
                            ],
                            [
                              "TMDB_API_KEY",
                              "Optional",
                              "Server default TMDB key",
                            ],
                            [
                              "REFRESH_HOURS",
                              "Optional",
                              "Default: 6",
                            ],
                          ].map(([k, req, desc]) => (
                            <tr
                              key={k}
                              className="border-b border-[#1e1e3a]"
                            >
                              <td className="py-2 pr-3 text-purple-400 font-mono">
                                {k}
                              </td>
                              <td className="py-2 pr-3">
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded ${
                                    req === "Required*"
                                      ? "bg-yellow-500/10 text-yellow-400"
                                      : "bg-green-500/10 text-green-400"
                                  }`}
                                >
                                  {req}
                                </span>
                              </td>
                              <td className="py-2 text-gray-500">{desc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-gray-600 text-xs mt-2">
                        * Set RENDER_EXTERNAL_URL{" "}
                        <em>after</em> first deploy.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <span>🖥️</span> Local Development
                </h3>
                <div className="bg-[#0a0a1a] rounded-lg p-4 border border-[#1e1e3a] space-y-1 font-mono text-xs text-gray-400">
                  <p className="text-green-400">
                    git clone https://github.com/you/stremio-m3u-addon.git
                  </p>
                  <p className="text-green-400">cd stremio-m3u-addon</p>
                  <p className="text-green-400">npm install</p>
                  <p className="text-green-400">node server.js</p>
                  <p className="text-gray-600">
                    # Open http://localhost:7000/configure
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "api" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <span>📡</span> API Endpoints
                </h3>
                <div className="space-y-3">
                  {[
                    {
                      method: "GET",
                      path: "/{config}/manifest.json",
                      desc: "Stremio manifest with catalogs",
                    },
                    {
                      method: "GET",
                      path: "/{config}/catalog/movie/{id}.json",
                      desc: "Catalog with ?search=, ?genre=, ?skip=",
                    },
                    {
                      method: "GET",
                      path: "/{config}/meta/movie/{id}.json",
                      desc: "Movie metadata + TMDB fallback",
                    },
                    {
                      method: "GET",
                      path: "/{config}/stream/movie/{id}.json",
                      desc: "Stream URL for a movie",
                    },
                    {
                      method: "POST",
                      path: "/api/validate",
                      desc: "Validate M3U URL",
                    },
                    {
                      method: "GET",
                      path: "/health",
                      desc: "Server health (used by keep-alive)",
                    },
                  ].map((ep, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 py-2 border-b border-[#1e1e3a] last:border-0"
                    >
                      <span
                        className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${
                          ep.method === "GET"
                            ? "bg-green-500/10 text-green-400"
                            : "bg-blue-500/10 text-blue-400"
                        }`}
                      >
                        {ep.method}
                      </span>
                      <div>
                        <code className="text-sm text-purple-400">
                          {ep.path}
                        </code>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {ep.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Server Source ── */}
        <section className="mb-16">
          <h2 className="text-xl font-bold text-center mb-6 gradient-text">
            Server Source Code
          </h2>
          <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
            <p className="text-sm text-gray-400 mb-4">
              You need these 2 files at the{" "}
              <strong className="text-gray-200">root</strong> of your GitHub
              repo. Click to expand and copy.
            </p>
            <ServerFile
              name="server.js"
              desc="Complete Stremio addon server (M3U parser, TMDB fallback, keep-alive)"
            />
            <ServerFile
              name="package.json"
              desc="Dependencies: express, cors, axios"
            />
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="text-center text-gray-600 text-xs pb-8 space-y-2">
          <p>
            Built for Stremio · M3U Addon v3.0 · Config-in-URL Architecture
          </p>
          <p>
            Auto-refreshes every 6h · Keep-alive every 10 min · TMDB fallback
          </p>
        </footer>
      </div>
    </div>
  );
}

// ─── Server File Component ───────────────────────────────────
function ServerFile({ name, desc }: { name: string; desc: string }) {
  const [expanded, setExpanded] = useState(false);
  const content = name === "package.json" ? PKG_JSON : SERVER_JS;

  return (
    <div className="mb-4 last:mb-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-3 px-4 bg-[#0a0a1a] rounded-lg border border-[#1e1e3a] hover:border-purple-500/30 transition-all cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{name.endsWith(".js") ? "📄" : "📦"}</span>
          <div className="text-left">
            <div className="text-sm font-medium text-gray-200">{name}</div>
            <div className="text-xs text-gray-500">{desc}</div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 relative animate-fadeIn">
          <div className="absolute top-2 right-2 z-10">
            <CopyButton text={content} label="Copy File" />
          </div>
          <pre className="bg-[#0a0a1a] rounded-lg p-4 border border-[#1e1e3a] overflow-x-auto text-xs text-gray-400 max-h-[500px] overflow-y-auto whitespace-pre-wrap">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

const PKG_JSON = `{
  "name": "stremio-m3u-addon",
  "version": "3.0.0",
  "description": "Stremio M3U Addon — user-configurable source URL",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "axios": "^1.6.7"
  },
  "engines": {
    "node": ">=18"
  }
}`;

const SERVER_JS = `const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const PORT = parseInt(process.env.PORT, 10) || 7000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "";
const DEFAULT_TMDB = process.env.TMDB_API_KEY || "";
const REFRESH_HOURS = parseInt(process.env.REFRESH_HOURS, 10) || 6;
const REFRESH_MS = REFRESH_HOURS * 3600000;
const KEEP_ALIVE_MS = 10 * 60000;

const sourceCache = {};
const tmdbCache = {};

function encodeConfig(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function decodeConfig(str) {
  try {
    return JSON.parse(Buffer.from(str, "base64url").toString("utf-8"));
  } catch {
    try { return JSON.parse(Buffer.from(str, "base64").toString("utf-8")); }
    catch { return null; }
  }
}

function parseM3U(raw) {
  const lines = raw.split(/\\r?\\n/);
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
  const tvgLogo = getAttr("tvg-logo");
  const group = getAttr("group-title");
  const ci = line.lastIndexOf(",");
  const rawName = ci !== -1 ? line.substring(ci + 1).trim() : "";
  return { type: getAttr("type") || "movie", tvgLogo, group, rawName, ...parseDisplayName(rawName) };
}

function parseDisplayName(name) {
  const d = { title: name, year: null, genre: [], duration: null,
    director: null, writers: null, stars: [], imdbRating: null, language: null };
  if (!name) return d;
  const imdbM = name.match(/[I\\u{1D5DC}][M\\u{1D5E0}][D\\u{1D5D7}][B\\u{1D5D5}]\\s*([\\d.]+)/iu);
  if (imdbM) d.imdbRating = parseFloat(imdbM[1]);
  const years = [...name.matchAll(/\\b((?:19|20)\\d{2})\\b/g)];
  if (years.length) d.year = parseInt(years[0][1], 10);
  const tM = name.match(/^([^(]*?)(?:\\s*\\(|$)/);
  if (tM && tM[1].trim()) d.title = tM[1].trim();
  const gM = name.match(/‧\\s*([\\w\\s\\\\\\/|]+(?:\\s*[\\w\\s\\\\\\/|]+)*)\\s*‧/);
  if (gM) {
    d.genre = gM[1].split(/[\\\\\\/|]/).map(g => g.trim()).filter(Boolean);
    const langs = ["Hindi","Tamil","Telugu","Malayalam","Kannada","Bengali","English","Korean","Japanese"];
    const last = d.genre[d.genre.length - 1];
    if (last && langs.some(l => l.toLowerCase() === last.toLowerCase())) d.language = last;
  }
  const durM = name.match(/(\\d+h\\s*\\d*m?)/i);
  if (durM) d.duration = durM[1];
  const dirM = name.match(/Directors?\\s+([^|)]+)/i);
  if (dirM) d.director = dirM[1].trim();
  const staM = name.match(/Stars?\\s+(.+?)(?:\\)|$)/i);
  if (staM) d.stars = staM[1].split("‧").map(s => s.trim()).filter(Boolean);
  return d;
}

function makeId(item) {
  const slug = \`\${item.title}__\${item.year || "0"}\`
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return \`m3u_\${slug}\`;
}

async function fetchTMDB(title, year, tmdbKey) {
  if (!tmdbKey) return null;
  const ck = \`\${title}|\${year || ""}\`;
  if (ck in tmdbCache) return tmdbCache[ck];
  try {
    const q = encodeURIComponent(title);
    let url = \`https://api.themoviedb.org/3/search/movie?api_key=\${tmdbKey}&query=\${q}\`;
    if (year) url += \`&year=\${year}\`;
    let { data } = await axios.get(url, { timeout: 8000 });
    if ((!data.results || !data.results.length) && year) {
      const r2 = await axios.get(\`https://api.themoviedb.org/3/search/movie?api_key=\${tmdbKey}&query=\${q}\`, { timeout: 8000 });
      data = r2.data;
    }
    if (!data.results || !data.results.length) { tmdbCache[ck] = null; return null; }
    const mid = data.results[0].id;
    const { data: det } = await axios.get(
      \`https://api.themoviedb.org/3/movie/\${mid}?api_key=\${tmdbKey}&append_to_response=credits,external_ids\`,
      { timeout: 8000 }
    );
    const result = {
      poster: det.poster_path ? \`https://image.tmdb.org/t/p/w500\${det.poster_path}\` : null,
      background: det.backdrop_path ? \`https://image.tmdb.org/t/p/w1280\${det.backdrop_path}\` : null,
      description: det.overview || null,
      imdbRating: det.vote_average ? det.vote_average.toFixed(1) : null,
      year: det.release_date ? new Date(det.release_date).getFullYear() : null,
      genres: det.genres ? det.genres.map(g => g.name) : [],
      runtime: det.runtime ? \`\${Math.floor(det.runtime/60)}h \${det.runtime%60}m\` : null,
      director: det.credits?.crew?.find(c => c.job === "Director")?.name || null,
      cast: det.credits?.cast?.slice(0,5).map(c => c.name) || [],
      imdb_id: det.imdb_id || det.external_ids?.imdb_id || null,
    };
    tmdbCache[ck] = result;
    return result;
  } catch (err) {
    console.error("[TMDB]", title, err.message);
    tmdbCache[ck] = null;
    return null;
  }
}

async function getSource(m3uUrl) {
  const now = Date.now();
  const cached = sourceCache[m3uUrl];
  if (cached && (now - cached.ts) < REFRESH_MS) return cached;
  console.log("[M3U] Fetching:", m3uUrl.substring(0, 80));
  try {
    const { data } = await axios.get(m3uUrl, { timeout: 60000, responseType: "text" });
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
        if (a.imdbRating && b.imdbRating) return b.imdbRating - a.imdbRating;
        return (a.title || "").localeCompare(b.title || "");
      });
    }
    const groupTitles = Object.keys(catalogMap).sort();
    const result = { items, catalogMap, groupTitles, ts: now };
    sourceCache[m3uUrl] = result;
    console.log("[M3U] ✅", items.length, "items in", groupTitles.length, "groups");
    return result;
  } catch (err) {
    console.error("[M3U] ❌", err.message);
    if (cached) return cached;
    return { items: [], catalogMap: {}, groupTitles: [], ts: now };
  }
}

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
    if (imdbRating) parts.push("⭐ IMDB " + imdbRating);
    if (year) parts.push("📅 " + year);
    if (runtime) parts.push("⏱ " + runtime);
    if (genres.length) parts.push("🎭 " + genres.join(", "));
    if (director) parts.push("🎬 Director: " + director);
    if (cast.length) parts.push("🌟 " + cast.join(", "));
    description = parts.join("\\n") || item.rawName || item.title;
  }
  const meta = { id: item.id, type: "movie", name: item.title };
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
    if (catalogId === \`m3u_\${g.replace(/[^a-zA-Z0-9]/g, "_")}\`) return g;
  }
  return null;
}

function buildManifest(source) {
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
      type: "movie", id: \`m3u_\${g.replace(/[^a-zA-Z0-9]/g, "_")}\`, name: g,
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
    description: \`Stream \${items.length} titles from M3U playlists\`,
    logo: "https://img.icons8.com/color/512/popcorn-time.png",
    resources: ["catalog", "meta", "stream"], types: ["movie"],
    catalogs,
    behaviorHints: { adult: false, configurable: true, configurationRequired: true },
    idPrefixes: ["m3u_"],
  };
}

const app = express();
app.use(cors());
app.use(express.json());

function getBaseUrl(req) {
  if (RENDER_URL) return RENDER_URL;
  return \`\${req.headers["x-forwarded-proto"] || req.protocol || "http"}://\${req.get("host")}\`;
}

app.use("/configure", express.static(path.join(__dirname, "configure")));
app.get("/", (req, res) => res.redirect("/configure"));

app.post("/api/validate", async (req, res) => {
  const { m3uUrl } = req.body;
  if (!m3uUrl) return res.json({ ok: false, error: "No URL" });
  try {
    const source = await getSource(m3uUrl);
    res.json({
      ok: true, items: source.items.length,
      groups: source.groupTitles,
      groupCounts: source.groupTitles.map(g => ({ name: g, count: (source.catalogMap[g] || []).length })),
    });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.post("/api/config", (req, res) => {
  const { m3uUrl, tmdbKey } = req.body;
  if (!m3uUrl) return res.json({ ok: false, error: "M3U URL required" });
  const config = { m3uUrl };
  if (tmdbKey) config.tmdbKey = tmdbKey;
  const encoded = encodeConfig(config);
  const base = getBaseUrl(req);
  res.json({ ok: true, configId: encoded,
    manifestUrl: \`\${base}/\${encoded}/manifest.json\`,
    stremioUrl: \`stremio://\${base.replace(/^https?:\\\\/\\\\//, "")}/\${encoded}/manifest.json\` });
});

app.get("/:config/manifest.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.status(400).json({ error: "Invalid config" });
  try {
    const source = await getSource(cfg.m3uUrl);
    res.json(buildManifest(source));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/:config/catalog/:type/:id/:extra?.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ metas: [] });
  try {
    const source = await getSource(cfg.m3uUrl);
    const tmdbKey = cfg.tmdbKey || DEFAULT_TMDB;
    const { id } = req.params;
    const extras = {};
    const extraStr = req.params.extra || "";
    if (extraStr) {
      decodeURIComponent(extraStr).split("&").forEach(p => {
        const eq = p.indexOf("=");
        if (eq !== -1) extras[p.slice(0, eq)] = p.slice(eq + 1);
      });
    }
    const search = (extras.search || "").toLowerCase();
    const genre = extras.genre || "";
    const skip = parseInt(extras.skip, 10) || 0;
    let items = id === "m3u_all" ? [...source.items]
      : [...(source.catalogMap[groupIdToKey(id, source.groupTitles)] || [])];
    if (search) items = items.filter(i =>
      (i.title||"").toLowerCase().includes(search) ||
      (i.rawName||"").toLowerCase().includes(search));
    if (genre) items = items.filter(i =>
      (i.genre||[]).includes(genre) || i.language === genre);
    items.sort((a,b) => {
      if (a.year && b.year && a.year !== b.year) return b.year - a.year;
      if (a.imdbRating && b.imdbRating) return b.imdbRating - a.imdbRating;
      return (a.title||"").localeCompare(b.title||"");
    });
    const page = items.slice(skip, skip + 100);
    const metas = [];
    for (let i = 0; i < page.length; i += 5) {
      const batch = page.slice(i, i + 5);
      metas.push(...await Promise.all(batch.map(it => toMeta(it, tmdbKey, false))));
    }
    res.json({ metas });
  } catch (err) { console.error("[CATALOG]", err.message); res.json({ metas: [] }); }
});

app.get("/:config/meta/:type/:id.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ meta: null });
  try {
    const source = await getSource(cfg.m3uUrl);
    const item = source.items.find(i => i.id === req.params.id);
    if (!item) return res.json({ meta: null });
    res.json({ meta: await toMeta(item, cfg.tmdbKey || DEFAULT_TMDB, true) });
  } catch (err) { res.json({ meta: null }); }
});

app.get("/:config/stream/:type/:id.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg || !cfg.m3uUrl) return res.json({ streams: [] });
  try {
    const source = await getSource(cfg.m3uUrl);
    const item = source.items.find(i => i.id === req.params.id);
    if (!item || !item.streamUrl) return res.json({ streams: [] });
    res.json({ streams: [{
      title: "▶️ " + item.title + (item.duration ? " (" + item.duration + ")" : ""),
      url: item.streamUrl,
      behaviorHints: { notWebReady: false, bingeGroup: item.group || "default" },
    }] });
  } catch (err) { res.json({ streams: [] }); }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    sources: Object.keys(sourceCache).length,
    totalItems: Object.values(sourceCache).reduce((s, c) => s + c.items.length, 0),
    tmdbCacheSize: Object.keys(tmdbCache).length,
    uptime: Math.floor(process.uptime()),
  });
});

function startKeepAlive() {
  if (!RENDER_URL) { console.log("[KEEP-ALIVE] Disabled — no RENDER_EXTERNAL_URL"); return; }
  const pingUrl = RENDER_URL + "/health";
  console.log("[KEEP-ALIVE] Pinging", pingUrl, "every", KEEP_ALIVE_MS / 60000, "min");
  setInterval(async () => {
    try { await axios.get(pingUrl, { timeout: 15000 }); console.log("[KEEP-ALIVE] OK"); }
    catch (err) { console.error("[KEEP-ALIVE] ❌", err.message); }
  }, KEEP_ALIVE_MS);
}

setInterval(() => {
  const cutoff = Date.now() - 24 * 3600000;
  for (const url of Object.keys(sourceCache)) {
    if (sourceCache[url].ts < cutoff) { delete sourceCache[url]; }
  }
}, 3600000);

app.listen(PORT, "0.0.0.0", () => {
  console.log("🎬 Stremio M3U Addon v3.0");
  console.log("PORT:", PORT);
  console.log("Render URL:", RENDER_URL || "N/A");
  console.log("TMDB:", DEFAULT_TMDB ? "✅" : "❌ (user provides)");
  console.log("Refresh: every", REFRESH_HOURS + "h");
  console.log("→ http://localhost:" + PORT + "/configure");
  startKeepAlive();
});`;
