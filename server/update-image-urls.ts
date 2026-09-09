import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';

const ASSETS = 'https://assets.cocktaillog.com/images/cocktail-w600/';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
type Row = Record<string, string>;
export type ProbeResult = { ok: boolean; status: number | null; reason?: string };
type Attempt = ProbeResult & { url: string };
export type ImageResult = {
  id: string;
  name: string;
  previousUrl: string;
  url: string;
  result: 'updated' | 'verified' | 'failed';
  attempts: Attempt[];
};

export function imageCandidates(original: string): string[] {
  let url: URL;
  try {
    url = new URL(original);
  } catch {
    return [];
  }
  if (!['cocktaillog.com', 'www.cocktaillog.com', 'assets.cocktaillog.com'].includes(url.hostname))
    return [];
  const filename = url.pathname.split('/').pop() || '';
  const match = filename.match(/^(cocktail_[\w-]+)\.(jpg|jpeg|png|webp)$/i);
  if (!match) return [];
  const [, stem, extension] = match;
  const names = [stem, `${stem}_01`];
  const numbered = stem.match(/^(.*)_(\d{2})$/);
  if (numbered) {
    const [, root, number] = numbered;
    names.push(`${root}-${number}_01`, `${root}-01_${number}`);
  } else {
    names.push(`${stem}-01_01`);
  }
  return [...new Set(names.map((name) => `${ASSETS}${name}.${extension}`))];
}

export function isImage(bytes: Uint8Array, type: string): boolean {
  if (!type.toLowerCase().startsWith('image/') || bytes.length < 12) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return true;
  const signature = new TextDecoder().decode(bytes.slice(0, 12));
  return (
    signature.startsWith('GIF87a') ||
    signature.startsWith('GIF89a') ||
    (signature.startsWith('RIFF') && signature.endsWith('WEBP'))
  );
}

export async function probeImage(url: string): Promise<ProbeResult> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'MillefleursImageUrlChecker/1.0', Accept: 'image/*' },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, status: response.status, reason: `HTTP ${response.status}` };
    }
    const type = response.headers.get('content-type') || '';
    if (
      !type.startsWith('image/') ||
      Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES
    ) {
      await response.body?.cancel();
      return {
        ok: false,
        status: response.status,
        reason: 'Not an image or image exceeds size limit',
      };
    }
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, status: response.status, reason: 'Empty body' };
    let size = 0;
    let signature: Uint8Array = new Uint8Array();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (signature.length < 12)
          signature = new Uint8Array([
            ...signature,
            ...chunk.value.slice(0, 12 - signature.length),
          ]);
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return { ok: false, status: response.status, reason: 'Image exceeds size limit' };
        }
      }
    } finally {
      reader.releaseLock();
    }
    return isImage(signature, type)
      ? { ok: true, status: response.status }
      : { ok: false, status: response.status, reason: 'Invalid image signature' };
  } catch (error) {
    return {
      ok: false,
      status: null,
      reason: error instanceof Error ? error.message : 'Network error',
    };
  }
}

export async function resolveImage(
  row: Row,
  probe: (url: string) => Promise<ProbeResult> = probeImage,
): Promise<ImageResult> {
  const attempts: Attempt[] = [];
  for (const url of imageCandidates(row.image)) {
    const result = await probe(url);
    attempts.push({ url, ...result });
    if (result.ok)
      return {
        id: row.id,
        name: row.name,
        previousUrl: row.image,
        url,
        result: url === row.image ? 'verified' : 'updated',
        attempts,
      };
    // Do not keep guessing names after a permission error, rate limit or network failure.
    if (
      result.status === 401 ||
      result.status === 403 ||
      result.status === 429 ||
      result.status === null ||
      result.status >= 500
    )
      break;
  }
  return {
    id: row.id,
    name: row.name,
    previousUrl: row.image,
    url: row.image,
    result: 'failed',
    attempts,
  };
}

export function serializeCsv(rows: Row[], columns: string[], eol: string): string {
  const quote = (value: string) =>
    /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return (
    [columns, ...rows.map((row) => columns.map((column) => row[column]))]
      .map((row) => row.map(quote).join(','))
      .join(eol) + eol
  );
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function atomicWrite(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

export async function updateImageUrls() {
  const csvPath = 'data/raw/cocktail.csv',
    manifestPath = 'data/source-manifest.json',
    reportPath = 'data/image-url-update-report.json';
  const before = readFileSync(csvPath, 'utf8');
  const rows = parse(before, { columns: true, bom: true, skip_empty_lines: true }) as Row[];
  if (!rows.length || !['id', 'name', 'image'].every((key) => key in rows[0]))
    throw new Error('Invalid cocktail CSV');
  const results: ImageResult[] = new Array(rows.length);
  let cursor = 0,
    completed = 0,
    stop = false;
  const startedAt = new Date().toISOString();
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      if (stop) {
        results[index] = {
          id: rows[index].id,
          name: rows[index].name,
          previousUrl: rows[index].image,
          url: rows[index].image,
          result: 'failed',
          attempts: [],
        };
        continue;
      }
      results[index] = await resolveImage(rows[index]);
      if (results[index].attempts.some((a) => a.status === 429)) stop = true;
      completed++;
      if (completed % 50 === 0 || completed === rows.length)
        console.log(
          `Checked ${completed}/${rows.length}; verified ${results.filter((r) => r && r.result !== 'failed').length}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  const updated = results.filter((r) => r.result === 'updated').length;
  const verified = results.filter((r) => r.result === 'verified').length;
  const failed = results.filter((r) => r.result === 'failed').length;
  const summary = {
    total: rows.length,
    fetched: updated + verified,
    updated,
    alreadyValid: verified,
    failed,
    requests: results.reduce((n, r) => n + r.attempts.length, 0),
    stoppedForRateLimit: stop,
  };
  atomicWrite(
    reportPath,
    JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), summary, results }, null, 2) +
      '\n',
  );
  if (readFileSync(csvPath, 'utf8') !== before)
    throw new Error('CSV changed during URL checks. No CSV changes written; see report.');
  if (updated) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (let i = 0; i < rows.length; i++) rows[i].image = results[i].url;
    const after =
      (before.startsWith('\ufeff') ? '\ufeff' : '') +
      serializeCsv(rows, Object.keys(rows[0]), before.includes('\r\n') ? '\r\n' : '\n');
    manifest.files['cocktail.csv'].original_sha256 ??= manifest.files['cocktail.csv'].sha256;
    manifest.files['cocktail.csv'].sha256 = hash(after);
    manifest.files['cocktail.csv'].rows = rows.length;
    atomicWrite(csvPath, after);
    atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report: ${reportPath}`);
  return summary;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await updateImageUrls();
