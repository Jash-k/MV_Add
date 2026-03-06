// ─── M3U Parser with TMDB Fallback ───────────────────────────────────────────

export interface MovieEntry {
  id: string;
  title: string;          // raw title from M3U
  cleanTitle: string;     // parsed movie name only
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

// ─── Unicode Bold → ASCII ─────────────────────────────────────────────────────
const BOLD_MAP: Record<string, string> = {
  '𝗜':'I','𝗠':'M','𝗗':'D','𝗕':'B','𝟬':'0','𝟭':'1','𝟮':'2','𝟯':'3',
  '𝟰':'4','𝟱':'5','𝟲':'6','𝟳':'7','𝟴':'8','𝟵':'9','𝗔':'A','𝗖':'C',
  '𝗘':'E','𝗙':'F','𝗚':'G','𝗛':'H','𝗝':'J','𝗞':'K','𝗟':'L','𝗡':'N',
  '𝗢':'O','𝗣':'P','𝗤':'Q','𝗥':'R','𝗦':'S','𝗧':'T','𝗨':'U','𝗩':'V',
  '𝗪':'W','𝗫':'X','𝗬':'Y','𝗭':'Z',
};

function decodeBold(str: string): string {
  return str.replace(/[𝗜𝗠𝗗𝗕𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵𝗔𝗖𝗘𝗙𝗚𝗛𝗝𝗞𝗟𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭]/g,
    (c) => BOLD_MAP[c] || c);
}

// ─── Attribute Extractor ──────────────────────────────────────────────────────
function parseExtinfAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) attrs[m[1]] = m[2];
  const commaIdx = line.lastIndexOf(',');
  if (commaIdx !== -1) attrs['_title'] = line.slice(commaIdx + 1).trim();
  return attrs;
}

// ─── Title Cleaning ───────────────────────────────────────────────────────────
export function cleanMovieTitle(raw: string): string {
  let t = decodeBold(raw);

  // Remove the parenthetical metadata block: (IMDB 8.0 2026 ‧ ...)
  t = t.replace(/\s*\((?:IMDB|𝗜𝗠𝗗𝗕)[^)]*\)/gi, '');
  // Remove trailing year-paren blocks like (2026) or (2026 ‧ Drama)
  t = t.replace(/\s*\(\d{4}[^)]*\)/g, '');
  // Remove ‧ separated metadata segments after the title
  t = t.replace(/\s*‧.*$/g, '');
  // Remove "IMDB X.X" patterns
  t = t.replace(/\bIMDB\b\s*[\d.]+/gi, '');
  // Remove Director / Writers / Stars inline text
  t = t.replace(/\s*(?:Director|Writers?|Stars?)\s+[^‧(]+/gi, '');
  // Remove rating patterns like (8.0) or 8.0
  t = t.replace(/\(\d\.\d\)/g, '');
  // Remove year standalone at end
  t = t.replace(/\s+\d{4}\s*$/, '');
  // Remove pipe-separated parts
  t = t.replace(/\s*\|.*$/, '');
  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();
  // Remove trailing special chars
  t = t.replace(/[‧•·|–—]+\s*$/, '').trim();

  return t;
}

// ─── Metadata Extractors ──────────────────────────────────────────────────────
function extractImdbRating(title: string): string | undefined {
  const t = decodeBold(title);
  const m = t.match(/IMDB\s*([\d.]+)/i);
  return m ? m[1] : undefined;
}

function extractYear(title: string): string | undefined {
  // Look for 4-digit year after IMDB rating pattern
  const t = decodeBold(title);
  const m = t.match(/IMDB\s*[\d.]+\s+(\d{4})/i) || t.match(/\b(20\d{2}|19\d{2})\b/);
  return m ? (m[1] || m[0]) : undefined;
}

function extractDuration(title: string): string | undefined {
  const m = title.match(/(\d+h\s*\d*m|\d+\s*min)/i);
  return m ? m[0].trim() : undefined;
}

const GENRE_WORDS = ['Adventure','Action','Drama','Comedy','Horror','Thriller',
  'Romance','Sci-Fi','Fantasy','Crime','Mystery','Documentary','Animation',
  'Biography','History','Sport','Musical','Family','War','Western','Superhero'];

function extractGenre(title: string): string | undefined {
  // Try to find genre block: typically after duration like "2h 27m ‧ Adventure\Action\Drama"
  const genrePattern = new RegExp(
    `(${GENRE_WORDS.join('|')})(?:[\\\\|/,‧·•]\\s*(?:${GENRE_WORDS.join('|')}))*`,
    'i'
  );
  const m = title.match(genrePattern);
  if (m) return m[0].replace(/[\\|/‧·•]/g, ', ').replace(/,\s*,/g, ',').trim();
  return undefined;
}

function extractLanguage(title: string): string | undefined {
  const langs = ['Tamil','Telugu','Hindi','Malayalam','Kannada','English','Bengali','Marathi'];
  for (const l of langs) {
    if (new RegExp(`\\b${l}\\b`, 'i').test(title)) return l;
  }
  return undefined;
}

function extractDirector(title: string): string | undefined {
  const m = title.match(/Director\s+([^|‧()\n]+)/i);
  return m ? m[1].trim().replace(/\s*\|.*/, '') : undefined;
}

function extractWriters(title: string): string | undefined {
  const m = title.match(/Writers?\s+([^|‧()\n]+)/i);
  return m ? m[1].trim().replace(/\s*\|.*/, '') : undefined;
}

function extractStars(title: string): string | undefined {
  const m = title.match(/Stars?\s+([^)‧\n]+)/i);
  if (!m) return undefined;
  return m[1].replace(/‧/g, ',').replace(/\s*\|.*/, '').trim();
}

// ─── ID Generation ────────────────────────────────────────────────────────────
let _counter = 0;
function makeId(title: string): string {
  _counter++;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return `vt_${slug}_${_counter}`;
}

// ─── Main Parser ──────────────────────────────────────────────────────────────
export function parseM3U(content: string, targetGroups: string[] = []): MovieEntry[] {
  _counter = 0;
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const entries: MovieEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXTINF:')) continue;

    const attrs = parseExtinfAttrs(line);
    const rawTitle = attrs['_title'] || 'Unknown';
    const groupTitle = attrs['group-title'] || '';

    // Group filter
    if (targetGroups.length > 0 && !targetGroups.some(g => groupTitle.includes(g))) continue;

    // Find URL (next non-comment line)
    let url = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].startsWith('#')) { url = lines[j]; break; }
    }
    if (!url) continue;

    const cleanTitle = cleanMovieTitle(rawTitle);
    const poster = attrs['tvg-logo'] || attrs['group-logo'] || '';

    entries.push({
      id: makeId(cleanTitle || rawTitle),
      title: rawTitle,
      cleanTitle,
      url,
      poster,
      background: poster,
      logo: poster,
      groupTitle,
      type: attrs['type'] || 'movie',
      imdbRating: extractImdbRating(rawTitle),
      year: extractYear(rawTitle),
      genre: extractGenre(rawTitle),
      duration: extractDuration(rawTitle),
      director: extractDirector(rawTitle),
      writers: extractWriters(rawTitle),
      stars: extractStars(rawTitle),
      language: extractLanguage(rawTitle) || extractLanguage(groupTitle),
      description: '',
      tmdbFetched: false,
    });
  }

  return entries;
}

// ─── Merge Streams (same movie, multiple sources) ─────────────────────────────
export function mergeEntries(existing: MovieEntry[], incoming: MovieEntry[]): MovieEntry[] {
  const map = new Map<string, MovieEntry>();
  for (const e of existing) map.set(e.cleanTitle.toLowerCase(), e);

  for (const n of incoming) {
    const key = n.cleanTitle.toLowerCase();
    if (map.has(key)) {
      const ex = map.get(key)!;
      // Keep best poster/metadata, merge urls (store extra in streams list)
      map.set(key, {
        ...ex,
        poster: ex.poster || n.poster,
        background: ex.background || n.background,
        imdbRating: ex.imdbRating || n.imdbRating,
        year: ex.year || n.year,
        genre: ex.genre || n.genre,
        duration: ex.duration || n.duration,
        director: ex.director || n.director,
        stars: ex.stars || n.stars,
        description: ex.description || n.description,
      });
    } else {
      map.set(key, n);
    }
  }

  return [...map.values()];
}
