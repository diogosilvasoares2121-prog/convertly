import { DICTIONARIES, t, type MessageKey } from '../i18n';
import { FORMATS, formatFromExtension, type FormatId } from './formats';
import { availableTools } from './tools';
import type { ToolDef } from './types';

/**
 * Instant, local tool search with aliases (EN + PT) and format-pair understanding
 * ("png to jpg", "heic jpg", "jpeg → pdf").
 */

/** Multi-word phrases replaced before tokenising. */
const PHRASES: Array<[RegExp, string]> = [
  [/reduce (file )?size/g, 'compress'],
  [/make smaller/g, 'compress'],
  [/reduzir (o )?tamanho/g, 'compress'],
  [/remove audio|remover (o )?audio|sem som/g, 'mute'],
  [/data ?ur[li]/g, 'base64'],
  [/(→|->|=>|\s2\s)/g, ' to '],
];

/** Single-token aliases. Values are canonical tokens used in the index. */
const ALIASES: Record<string, string> = {
  jpeg: 'jpg',
  jpe: 'jpg',
  jfif: 'jpg',
  heif: 'heic',
  hif: 'heic',
  tif: 'tiff',
  mpg: 'mpeg',
  m4v: 'mp4',
  picture: 'image',
  pictures: 'image',
  photo: 'image',
  photos: 'image',
  pic: 'image',
  pics: 'image',
  img: 'image',
  images: 'image',
  imagem: 'image',
  imagens: 'image',
  foto: 'image',
  fotos: 'image',
  fotografia: 'image',
  join: 'merge',
  combine: 'merge',
  unite: 'merge',
  juntar: 'merge',
  unir: 'merge',
  combinar: 'merge',
  separate: 'split',
  divide: 'split',
  dividir: 'split',
  separar: 'split',
  shrink: 'compress',
  reduce: 'compress',
  optimize: 'compress',
  optimise: 'compress',
  smaller: 'compress',
  comprimir: 'compress',
  reduzir: 'compress',
  otimizar: 'compress',
  compressao: 'compress',
  converter: 'convert',
  conversao: 'convert',
  converte: 'convert',
  change: 'convert',
  redimensionar: 'resize',
  scale: 'resize',
  cortar: 'trim',
  recortar: 'crop',
  rodar: 'rotate',
  girar: 'rotate',
  rotacao: 'rotate',
  turn: 'rotate',
  extrair: 'extract',
  apagar: 'delete',
  eliminar: 'delete',
  remover: 'remove',
  organizar: 'organize',
  organise: 'organize',
  reorder: 'organize',
  ordenar: 'organize',
  movie: 'video',
  movies: 'video',
  videos: 'video',
  filme: 'video',
  sound: 'audio',
  music: 'audio',
  song: 'audio',
  musica: 'audio',
  som: 'audio',
  unzip: 'extract',
  descompactar: 'extract',
  compactar: 'zip',
  arquivo: 'archive',
  documento: 'pdf',
  mudo: 'mute',
  silenciar: 'mute',
  metadados: 'metadata',
  exif: 'metadata',
};

const STOPWORDS = new Set(['to', 'into', 'para', 'em', 'a', 'o', 'de', 'do', 'da', 'the', 'file', 'files', 'ficheiro', 'ficheiros', 'arquivos', 'my', 'online', 'free', 'and', 'e', 'from', 'format']);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export function tokenize(query: string): string[] {
  let q = normalizeText(query);
  for (const [re, rep] of PHRASES) q = q.replace(re, ` ${rep} `);
  return q
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((tok) => ALIASES[tok] ?? tok);
}

function formatToken(tok: string): FormatId | null {
  if (tok in FORMATS) return tok as FormatId;
  return formatFromExtension(tok);
}

interface IndexedTool {
  tool: ToolDef;
  tokens: Set<string>;
  text: string;
}

let index: IndexedTool[] | null = null;
let indexSize = -1;

function titleIn(tool: ToolDef, lang: keyof typeof DICTIONARIES): string {
  if ('text' in tool.title) return tool.title.text;
  return DICTIONARIES[lang][tool.title.key as MessageKey] ?? '';
}

function buildIndex(): IndexedTool[] {
  const tools = availableTools();
  if (index && indexSize === tools.length) return index;
  index = tools.map((tool) => {
    const parts = [
      tool.id.replace(/-/g, ' '),
      titleIn(tool, 'en'),
      titleIn(tool, 'pt'),
      ...tool.keywords,
      tool.category,
      ...(tool.accepts === '*' ? [] : tool.accepts),
      ...(tool.outputs ?? []),
    ];
    const text = normalizeText(parts.join(' '));
    const tokens = new Set(tokenize(parts.join(' ')));
    return { tool, tokens, text };
  });
  indexSize = tools.length;
  return index;
}

export interface SearchResult {
  tool: ToolDef;
  /** Label to display (may be contextual, e.g. "Compress JPG"). */
  label: string;
  score: number;
}

export function toolTitle(tool: ToolDef): string {
  return 'text' in tool.title ? tool.title.text : t(tool.title.key);
}

export function searchTools(query: string, limit = 30): SearchResult[] {
  const tokens = tokenize(query).filter((tok) => !STOPWORDS.has(tok));
  if (!tokens.length) return [];
  const formats = tokens.map(formatToken);
  const formatTokens = formats.filter((f): f is FormatId => !!f);
  const fromFormat = formatTokens[0] ?? null;
  const toFormat = formatTokens[1] ?? null;
  const singleFormat = tokens.length === 1 && fromFormat ? fromFormat : null;

  const results: SearchResult[] = [];
  for (const entry of buildIndex()) {
    const { tool } = entry;
    let score = 0;
    let matchedAll = true;
    for (const tok of tokens) {
      const fmt = formatToken(tok);
      if (entry.tokens.has(tok) || (fmt && entry.tokens.has(fmt))) score += 3;
      else if (fmt && tool.accepts === '*' && tool.formatTitleKey) score += 1; // "JPG → Base64"
      else if ([...entry.tokens].some((x) => x.startsWith(tok))) score += 2;
      else if (tok.length >= 3 && entry.text.includes(tok)) score += 1;
      else {
        matchedAll = false;
        break;
      }
    }
    if (!matchedAll) continue;

    // Format-pair intent: "png to jpg" should rank the PNG → JPG tool first.
    if (fromFormat && toFormat && tool.pair) {
      if (tool.preset?.from === fromFormat && tool.preset.to === toFormat) score += 20;
      else if (tool.preset?.to === fromFormat && tool.preset.from === toFormat) score -= 2;
    }
    if (singleFormat) {
      if (tool.pair && tool.preset?.from === singleFormat) score += 6;
      else if (tool.pair && tool.preset?.to === singleFormat) score += 3;
      else if (tool.accepts !== '*' && tool.accepts.includes(singleFormat)) score += 2;
    }
    if (tool.popular) score += 1;
    if (!tool.pair) score += 0.5;
    // Search-only shortcuts ("Extract RAR") are more specific than the generic tool they open.
    if (tool.hidden) score += 1.5;

    let label = toolTitle(tool);
    if (singleFormat && tool.formatTitleKey && tool.accepts !== '*' && tool.accepts.includes(singleFormat)) {
      label = t(tool.formatTitleKey, { format: FORMATS[singleFormat].label });
    } else if (singleFormat && tool.formatTitleKey && tool.accepts === '*') {
      label = t(tool.formatTitleKey, { format: FORMATS[singleFormat].label });
    }
    results.push({ tool, label, score });
  }

  results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    const key = r.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, limit);
}
