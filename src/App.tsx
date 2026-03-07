import { useState, useCallback, useRef, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────
interface GroupCount {
  name: string;
  count: number;
}

interface ScanResult {
  ok: boolean;
  items: number;
  groups: string[];
  groupCounts: GroupCount[];
  error?: string;
}

interface AddonResult {
  ok: boolean;
  manifestUrl: string;
  stremioUrl: string;
  error?: string;
}

// ─── Copy Button ─────────────────────────────────────────────
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
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
      className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 rounded-lg text-xs font-medium transition-all text-purple-300 border border-purple-500/30 hover:border-purple-500/60 cursor-pointer whitespace-nowrap"
    >
      {copied ? "✅ Copied!" : label}
    </button>
  );
}

// ─── Stat Card ───────────────────────────────────────────────
function StatCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color: string }) {
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
  const [serverUrl, setServerUrl] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [showTmdb, setShowTmdb] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [addonResult, setAddonResult] = useState<AddonResult | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"install" | "deploy" | "api">("install");
  const [groupSearch, setGroupSearch] = useState("");
  const [serverValid, setServerValid] = useState<boolean | null>(null);
  const [serverChecking, setServerChecking] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);
  const addonRef = useRef<HTMLDivElement>(null);

  // Step tracker
  const step = addonResult ? 3 : scanResult?.ok ? 2 : serverValid && m3uUrl ? 1 : serverUrl ? 0.5 : 0;

  // Reset downstream on URL change
  useEffect(() => {
    setScanResult(null);
    setScanError(null);
    setAddonResult(null);
  }, [m3uUrl]);

  useEffect(() => {
    setScanResult(null);
    setScanError(null);
    setAddonResult(null);
    setServerValid(null);
  }, [serverUrl]);

  // Check server health
  const checkServer = useCallback(async () => {
    if (!serverUrl.trim()) return;
    setServerChecking(true);
    setServerValid(null);
    try {
      const base = serverUrl.trim().replace(/\/+$/, "");
      const resp = await fetch(`${base}/health`, { mode: "cors" });
      if (resp.ok) {
        setServerValid(true);
      } else {
        setServerValid(false);
      }
    } catch {
      setServerValid(false);
    }
    setServerChecking(false);
  }, [serverUrl]);

  // Scan M3U via server API
  const scanSource = useCallback(async () => {
    if (!m3uUrl.trim() || !serverUrl.trim()) return;
    setLoading(true);
    setScanError(null);
    setScanResult(null);
    setAddonResult(null);

    try {
      const base = serverUrl.trim().replace(/\/+$/, "");
      const resp = await fetch(`${base}/api/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ m3uUrl: m3uUrl.trim() }),
      });
      const data: ScanResult = await resp.json();

      if (!data.ok) {
        setScanError(data.error || "Unknown error");
      } else {
        setScanResult(data);
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setScanError(`Network error: ${msg}. Is the server running at ${serverUrl}?`);
    }
    setLoading(false);
  }, [m3uUrl, serverUrl]);

  // Generate addon URL via server API
  const generateAddon = useCallback(async () => {
    if (!m3uUrl.trim() || !serverUrl.trim()) return;
    try {
      const base = serverUrl.trim().replace(/\/+$/, "");
      const resp = await fetch(`${base}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          m3uUrl: m3uUrl.trim(),
          tmdbKey: tmdbKey.trim() || undefined,
        }),
      });
      const data: AddonResult = await resp.json();
      if (data.ok) {
        setAddonResult(data);
        setTimeout(() => addonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setScanError(msg);
    }
  }, [m3uUrl, tmdbKey, serverUrl]);

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    scanSource();
  };

  const filteredGroups = scanResult?.groupCounts?.filter((g) =>
    g.name.toLowerCase().includes(groupSearch.toLowerCase())
  ) || [];

  const sortedGroups = [...filteredGroups].sort((a, b) => b.count - a.count);

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-200">
      {/* BG Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-purple-600/5 blur-[120px]" />
        <div className="absolute bottom-[-300px] right-[-200px] w-[600px] h-[600px] rounded-full bg-blue-600/5 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 sm:py-16">
        {/* ── Header ── */}
        <header className="text-center mb-10">
          <div className="text-5xl mb-3">🎬</div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-green-400 bg-clip-text text-transparent">
            M3U Stremio Addon
          </h1>
          <p className="text-gray-500 text-sm mt-2 max-w-lg mx-auto">
            v3.0 · Connect to your server → Enter M3U source → See movie count → Install in Stremio
          </p>
        </header>

        {/* ── Steps ── */}
        <div className="flex items-center justify-center gap-1 sm:gap-3 text-xs sm:text-sm mb-10 flex-wrap">
          {[
            { icon: "🖥️", label: "Server URL", threshold: 0.5 },
            { icon: "📝", label: "Enter M3U", threshold: 1 },
            { icon: "🔍", label: "Scan Source", threshold: 2 },
            { icon: "🔗", label: "Install", threshold: 3 },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-1 sm:gap-3">
              <div
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all ${
                  step >= s.threshold
                    ? "bg-purple-600/15 border-purple-500/40 text-purple-300"
                    : "bg-[#111127] border-[#1e1e3a] text-gray-600"
                }`}
              >
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </div>
              {i < 3 && (
                <span className={`font-bold ${step >= s.threshold ? "text-purple-500" : "text-gray-700"}`}>→</span>
              )}
            </div>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════ */}
        {/*  STEP 0: SERVER URL                                */}
        {/* ═══════════════════════════════════════════════════ */}
        <div className="bg-[#111127] rounded-2xl border border-[#1e1e3a] overflow-hidden shadow-2xl shadow-purple-900/10 mb-6">
          <div className="px-6 py-4 bg-gradient-to-r from-blue-600/10 to-cyan-600/10 border-b border-[#1e1e3a]">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="text-xl">🖥️</span>
              Server Connection
            </h2>
            <p className="text-gray-500 text-sm mt-1">Enter your deployed Stremio addon server URL</p>
          </div>
          <div className="p-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Server URL <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://your-addon.onrender.com"
                className="flex-1 px-4 py-3 bg-[#0a0a1a] border border-[#2a2a4a] rounded-xl text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all text-sm"
              />
              <button
                onClick={checkServer}
                disabled={!serverUrl.trim() || serverChecking}
                className="px-5 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap text-sm"
              >
                {serverChecking ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                    </svg>
                    Checking...
                  </span>
                ) : "🔌 Connect"}
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-1.5">
              Your Render deployment URL. The <code className="text-blue-400/60">/configure</code> page is also on this server.
            </p>

            {serverValid === true && (
              <div className="mt-3 flex items-center gap-2 text-green-400 text-sm bg-green-500/5 border border-green-500/20 rounded-lg px-4 py-2">
                <span>✅</span> Server is online and responding!
              </div>
            )}
            {serverValid === false && (
              <div className="mt-3 flex items-center gap-2 text-red-400 text-sm bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-2">
                <span>❌</span> Can't reach server. Make sure it's deployed and the URL is correct.
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════ */}
        {/*  STEP 1: M3U SOURCE INPUT                          */}
        {/* ═══════════════════════════════════════════════════ */}
        <form onSubmit={handleScanSubmit} className="mb-6">
          <div className={`bg-[#111127] rounded-2xl border overflow-hidden shadow-2xl shadow-purple-900/10 transition-all ${
            serverValid ? "border-[#1e1e3a]" : "border-[#1e1e3a] opacity-60 pointer-events-none"
          }`}>
            <div className="px-6 py-4 bg-gradient-to-r from-purple-600/10 to-blue-600/10 border-b border-[#1e1e3a]">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                Configure Your Source
                {!serverValid && <span className="text-xs text-gray-500 font-normal ml-2">(connect to server first)</span>}
              </h2>
              <p className="text-gray-500 text-sm mt-1">Paste your raw M3U URL — we'll scan it via the server</p>
            </div>

            <div className="p-6 space-y-5">
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
                    disabled={!m3uUrl.trim() || loading || !serverValid}
                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-lg shadow-purple-600/20 hover:shadow-purple-600/40 disabled:shadow-none flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                        </svg>
                        Scanning...
                      </>
                    ) : "🔍 Scan Source"}
                  </button>
                </div>
                <p className="text-gray-600 text-xs mt-1.5">Raw GitHub URL to your .m3u file. Must be publicly accessible.</p>
              </div>

              {/* TMDB Key */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowTmdb(!showTmdb)}
                  className="text-sm font-medium text-gray-400 hover:text-gray-200 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  🎬 TMDB API Key
                  <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full border border-green-500/20">Optional</span>
                  <svg className={`w-4 h-4 transition-transform ${showTmdb ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showTmdb && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={tmdbKey}
                      onChange={(e) => setTmdbKey(e.target.value)}
                      placeholder="your-tmdb-api-key-here"
                      className="w-full px-4 py-3 bg-[#0a0a1a] border border-[#2a2a4a] rounded-xl text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 transition-all text-sm font-mono"
                    />
                    <p className="text-gray-600 text-xs mt-1.5">
                      Fills in missing posters, descriptions & genres.{" "}
                      <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                        Get free key →
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>

        {/* ═══════════════════════════════════════════════════ */}
        {/*  SCAN ERROR                                        */}
        {/* ═══════════════════════════════════════════════════ */}
        {scanError && (
          <div className="mb-6 bg-red-500/5 border border-red-500/20 rounded-2xl p-5">
            <h3 className="text-red-400 font-semibold flex items-center gap-2 mb-2">
              <span className="text-xl">❌</span> Error
            </h3>
            <p className="text-gray-400 text-sm">{scanError}</p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/*  SCAN RESULTS — MOVIE COUNT                        */}
        {/* ═══════════════════════════════════════════════════ */}
        {scanResult?.ok && (
          <div ref={resultRef} className="space-y-5 mb-8">
            {/* Big Hero Count */}
            <div className="bg-gradient-to-br from-purple-600/10 via-[#111127] to-blue-600/10 rounded-2xl border border-purple-500/20 p-8 text-center">
              <div className="text-6xl sm:text-7xl font-black bg-gradient-to-r from-purple-400 via-blue-400 to-green-400 bg-clip-text text-transparent mb-2">
                {scanResult.items.toLocaleString()}
              </div>
              <div className="text-gray-400 text-lg">Movies Found</div>
              <div className="text-gray-600 text-sm mt-1">
                in {scanResult.groupCounts.length} catalog{scanResult.groupCounts.length !== 1 ? "s" : ""}
              </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon="📂" value={scanResult.groupCounts.length} label="Catalogs" color="text-blue-400" />
              <StatCard icon="🎬" value={scanResult.items} label="Total Movies" color="text-purple-400" />
              <StatCard
                icon="🏆"
                value={scanResult.groupCounts.length > 0
                  ? Math.max(...scanResult.groupCounts.map((g) => g.count))
                  : "—"}
                label="Largest Group"
                color="text-yellow-400"
              />
              <StatCard
                icon="📦"
                value={scanResult.groupCounts.length > 0
                  ? Math.min(...scanResult.groupCounts.map((g) => g.count))
                  : "—"}
                label="Smallest Group"
                color="text-green-400"
              />
            </div>

            {/* Catalog Breakdown */}
            {scanResult.groupCounts.length > 0 && (
              <div className="bg-[#111127] rounded-2xl border border-[#1e1e3a] overflow-hidden">
                <div className="px-6 py-4 border-b border-[#1e1e3a] flex items-center justify-between flex-wrap gap-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <span className="text-xl">📂</span>
                    Catalog Breakdown
                    <span className="text-xs text-gray-500 font-normal">
                      ({scanResult.groupCounts.length} groups)
                    </span>
                  </h3>
                  {scanResult.groupCounts.length > 5 && (
                    <input
                      type="text"
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="Filter catalogs..."
                      className="px-3 py-1.5 bg-[#0a0a1a] border border-[#2a2a4a] rounded-lg text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500 w-full sm:w-48"
                    />
                  )}
                </div>

                <div className="divide-y divide-[#1e1e3a] max-h-[500px] overflow-y-auto">
                  {sortedGroups.map((group) => (
                    <div key={group.name}>
                      <button
                        onClick={() => setExpandedGroup(expandedGroup === group.name ? null : group.name)}
                        className="w-full flex items-center justify-between px-6 py-3.5 hover:bg-[#16162e] transition-all cursor-pointer text-left"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-lg shrink-0">📁</span>
                          <span className="text-sm font-medium text-gray-200 truncate">
                            {group.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="bg-purple-600/20 text-purple-300 px-3 py-1 rounded-full text-sm font-bold">
                            {group.count}
                          </div>
                          <svg
                            className={`w-4 h-4 text-gray-500 transition-transform ${expandedGroup === group.name ? "rotate-180" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>

                      {expandedGroup === group.name && (
                        <div className="px-6 pb-4">
                          <div className="bg-[#0a0a1a] rounded-xl p-4 border border-[#1e1e3a]">
                            <div className="text-sm text-gray-400">
                              <span className="text-gray-500">Movies: </span>
                              <span className="text-purple-400 font-bold">{group.count}</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-2">
                              This catalog will appear in Stremio's Discover tab with genre filter and search.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GENERATE BUTTON */}
            <div className="text-center">
              <button
                onClick={generateAddon}
                className="w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-600/20 hover:shadow-purple-600/40 text-lg cursor-pointer"
              >
                🚀 Generate Addon URL
              </button>
              <p className="text-gray-600 text-xs mt-2">
                Config encoded in URL — no data stored on server
              </p>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/*  ADDON RESULT                                      */}
        {/* ═══════════════════════════════════════════════════ */}
        {addonResult?.ok && (
          <div ref={addonRef} className="mb-10">
            <div className="bg-[#111127] rounded-2xl border border-green-500/20 overflow-hidden shadow-2xl shadow-green-900/10">
              <div className="px-6 py-4 bg-gradient-to-r from-green-600/10 to-emerald-600/10 border-b border-green-500/20">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <span className="text-xl">🎉</span>
                  Your Addon is Ready!
                  <span className="text-sm font-normal text-green-400 ml-1">
                    — {scanResult?.items.toLocaleString()} movies
                  </span>
                </h3>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2 block">Manifest URL</label>
                  <div className="flex items-center gap-2 bg-[#0a0a1a] p-3 rounded-xl border border-[#2a2a4a]">
                    <code className="text-sm text-blue-400 break-all flex-1 select-all">
                      {addonResult.manifestUrl}
                    </code>
                    <CopyButton text={addonResult.manifestUrl} />
                  </div>
                </div>

                <a
                  href={addonResult.stremioUrl}
                  className="block w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold rounded-xl text-center transition-all shadow-lg shadow-green-600/20 hover:shadow-green-600/40 text-lg"
                >
                  📥 Install in Stremio
                </a>

                <div className="text-center text-gray-600 text-xs">
                  Or paste the manifest URL in Stremio → Addons → Search box
                </div>

                <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 text-sm">
                  <p className="text-purple-300 font-medium mb-1">💡 Want to change source later?</p>
                  <p className="text-gray-400 text-xs">
                    Just come back here, enter a new M3U URL, scan it, and install the new addon URL.
                    Each source gets its own unique URL — you can have multiple sources installed simultaneously!
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/*  FEATURES                                          */}
        {/* ═══════════════════════════════════════════════════ */}
        <section className="mt-12 mb-10">
          <h2 className="text-xl font-bold text-center mb-6 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            Features
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: "🔄", title: "Change Source Anytime", desc: "M3U URL is configured from this page. Change sources without redeploying the server." },
              { icon: "📊", title: "Live Movie Count", desc: "See total movies, catalog groups, and group sizes instantly after scanning." },
              { icon: "🎭", title: "Sort & Filter", desc: "Catalogs sorted by year & IMDB rating. Filter by genre in Stremio's UI." },
              { icon: "🎬", title: "TMDB Fallback", desc: "Missing poster or info? TMDB fills in the gaps automatically." },
              { icon: "⏰", title: "Auto-Refresh 6h", desc: "M3U source re-fetched every 6 hours. Always up-to-date content." },
              { icon: "💓", title: "Keep-Alive", desc: "Self-pings every 10 min to prevent Render free tier spin-down." },
            ].map((f, i) => (
              <div key={i} className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-5 hover:border-purple-500/30 transition-all group">
                <div className="text-2xl mb-2 group-hover:scale-110 transition-transform inline-block">{f.icon}</div>
                <h3 className="font-semibold text-sm text-gray-200 mb-1">{f.title}</h3>
                <p className="text-gray-500 text-xs leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════ */}
        {/*  TABS                                              */}
        {/* ═══════════════════════════════════════════════════ */}
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
                {tab === "install" && "📥 How It Works"}
                {tab === "deploy" && "🚀 Deploy Server"}
                {tab === "api" && "📡 API Reference"}
              </button>
            ))}
          </div>

          {activeTab === "install" && (
            <div className="space-y-4">
              <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><span>📋</span> Steps</h3>
                <ol className="space-y-3 text-sm text-gray-400">
                  {[
                    "Deploy the server to Render (see Deploy tab)",
                    "Enter your server URL above and click 'Connect'",
                    "Enter your raw GitHub M3U URL",
                    "Click 'Scan Source' to see movie count and catalogs",
                    "Optionally add TMDB API key for enhanced metadata",
                    "Click 'Generate Addon URL' to create your link",
                    "Click 'Install in Stremio' — opens Stremio automatically",
                  ].map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="text-purple-400 font-bold shrink-0">{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
                <h3 className="font-semibold mb-3 flex items-center gap-2"><span>📺</span> Expected M3U Format</h3>
                <div className="bg-[#0a0a1a] rounded-lg p-4 overflow-x-auto border border-[#1e1e3a]">
                  <pre className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">
{`#EXTM3U

#EXTINF:-1 type="movie" tvg-logo="https://poster.jpg" group-title="VT 🎬 | Tamil Movies",Movie Title (𝗜𝗠𝗗𝗕 7.5 2024 ‧ Action\\Drama\\Tamil ‧ 2h 30m Director Name | Stars Actor1 ‧ Actor2)
https://stream-url.mkv`}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === "deploy" && (
            <div className="space-y-4">
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 text-sm text-yellow-300">
                ⚠️ The server is <strong>self-contained</strong> — only 2 files needed. The <code>/configure</code> page is embedded inside server.js.
              </div>

              <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><span>🚀</span> Deploy to Render (Free Tier)</h3>
                <ol className="space-y-5 text-sm text-gray-400">
                  <li className="flex gap-3">
                    <span className="bg-purple-600/20 text-purple-400 w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold">1</span>
                    <div>
                      <strong className="text-gray-200 block mb-1">Create GitHub repo with 2 files at root:</strong>
                      <div className="bg-[#0a0a1a] rounded-lg p-3 border border-[#1e1e3a] font-mono text-xs">
                        <div className="text-gray-500">your-repo/</div>
                        <div className="text-green-400 ml-3">├── server.js</div>
                        <div className="text-green-400 ml-3">└── package.json</div>
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="bg-purple-600/20 text-purple-400 w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold">2</span>
                    <div>
                      <strong className="text-gray-200 block mb-1">Render Web Service settings:</strong>
                      <table className="w-full text-xs mt-2">
                        <tbody>
                          {[
                            ["Runtime", "Node"],
                            ["Build Command", "npm install"],
                            ["Start Command", "node server.js"],
                            ["Root Directory", "(leave empty)"],
                            ["Instance Type", "Free"],
                          ].map(([k, v]) => (
                            <tr key={k} className="border-b border-[#1e1e3a]">
                              <td className="py-2 pr-4 text-gray-500 font-medium">{k}</td>
                              <td className="py-2 text-blue-400 font-mono">{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="bg-purple-600/20 text-purple-400 w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold">3</span>
                    <div>
                      <strong className="text-gray-200 block mb-1">Set env vars (after first deploy):</strong>
                      <table className="w-full text-xs mt-2">
                        <tbody>
                          {[
                            ["RENDER_EXTERNAL_URL", "Required*", "Your .onrender.com URL (for keep-alive)"],
                            ["TMDB_API_KEY", "Optional", "Server default TMDB key"],
                            ["REFRESH_HOURS", "Optional", "Default: 6"],
                          ].map(([k, req, desc]) => (
                            <tr key={k} className="border-b border-[#1e1e3a]">
                              <td className="py-2 pr-3 text-purple-400 font-mono">{k}</td>
                              <td className="py-2 pr-3">
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  req === "Required*" ? "bg-yellow-500/10 text-yellow-400" : "bg-green-500/10 text-green-400"
                                }`}>{req}</span>
                              </td>
                              <td className="py-2 text-gray-500">{desc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </li>
                </ol>
              </div>

              <ServerFile name="server.js" desc="Complete self-contained server (configure page embedded)" content={SERVER_JS_NOTE} />
              <ServerFile name="package.json" desc="Dependencies: express, cors, axios" content={PKG_JSON} />
            </div>
          )}

          {activeTab === "api" && (
            <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2"><span>📡</span> API Endpoints</h3>
              <div className="space-y-3">
                {[
                  { method: "GET", path: "/configure", desc: "Configuration page (embedded HTML)" },
                  { method: "POST", path: "/api/validate", desc: "Validate M3U URL — returns movie count & groups" },
                  { method: "POST", path: "/api/config", desc: "Generate addon config — returns manifest & stremio URLs" },
                  { method: "GET", path: "/{config}/manifest.json", desc: "Stremio manifest with catalogs" },
                  { method: "GET", path: "/{config}/catalog/movie/{id}.json", desc: "Catalog with ?search=, ?genre=, ?skip=" },
                  { method: "GET", path: "/{config}/meta/movie/{id}.json", desc: "Movie metadata + TMDB fallback" },
                  { method: "GET", path: "/{config}/stream/movie/{id}.json", desc: "Stream URL" },
                  { method: "GET", path: "/health", desc: "Server health (used by keep-alive)" },
                ].map((ep, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b border-[#1e1e3a] last:border-0">
                    <span className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${
                      ep.method === "GET" ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"
                    }`}>{ep.method}</span>
                    <div>
                      <code className="text-sm text-purple-400">{ep.path}</code>
                      <p className="text-xs text-gray-500 mt-0.5">{ep.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Footer ── */}
        <footer className="text-center text-gray-600 text-xs pb-8 space-y-2">
          <p>Built for Stremio · M3U Addon v3.0 · Config-in-URL Architecture</p>
          <p>Auto-refreshes every 6h · Keep-alive every 10 min · TMDB fallback</p>
        </footer>
      </div>
    </div>
  );
}

// ─── Server File Component ───────────────────────────────────
function ServerFile({ name, desc, content }: { name: string; desc: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-[#111127] rounded-xl border border-[#1e1e3a] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-3 px-4 hover:bg-[#16162e] transition-all cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{name.endsWith(".js") ? "📄" : "📦"}</span>
          <div className="text-left">
            <div className="text-sm font-medium text-gray-200">{name}</div>
            <div className="text-xs text-gray-500">{desc}</div>
          </div>
        </div>
        <svg className={`w-5 h-5 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="relative border-t border-[#1e1e3a]">
          <div className="absolute top-2 right-2 z-10">
            <CopyButton text={content} label="📋 Copy" />
          </div>
          <pre className="p-4 overflow-x-auto text-xs text-gray-400 max-h-[500px] overflow-y-auto whitespace-pre-wrap bg-[#0a0a1a]">
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

const SERVER_JS_NOTE = `// server.js is too large to display inline here.
// Download it from the deploy/server.js file in the project,
// or visit your server at /configure — the configure page is embedded directly in server.js.
//
// Key features:
// - Self-contained: /configure page is embedded HTML (no static files needed)
// - M3U parser with IMDB rating, year, genre, director, stars extraction
// - TMDB fallback for missing metadata
// - Per-source cache with 6h auto-refresh
// - Keep-alive self-ping every 10 min
// - Config encoded in URL (base64) — no env M3U_URL needed
//
// Just place server.js + package.json at your GitHub repo root and deploy to Render.`;
