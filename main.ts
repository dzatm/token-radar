// Token Radar's entrypoint (Node 22, standard library only).
//
// The program reads the sealed snapshot, scores every pre-token protocol with the radar-2 model in
// lib/model.ts, writes the ranked board and the dashboard's data, copies the dashboard and its
// screenshots into the output, and writes the dossier with the vendored make.fun library. The
// dossier is the judge's copy of the entry: it must be byte for byte what buildDossier writes, so
// this program calls buildDossier with exactly the scorer's caps and writes the returned bytes
// unchanged. If buildDossier refuses, the program fails loudly instead of writing a substitute.
//
//   node main.ts --input /path/to/snapshot.json --output /path/to/out
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//   (at grade time: node main.ts, reading /input/snapshot.json, writing /output)

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's text cap: the only cap that shapes the dossier's bytes. */
const TEXT_MAX_BYTES = 65_536;
/** The gate's screenshot rules: 3 to 4 images, each at most 512 KiB. */
const SHOT_MAX_BYTES = 524_288;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** `--name <value>` or `--name=<value>` out of the arguments, else the fallback. */
function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = option('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
const out = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping dot-names; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashFiles.length === 0) fail('dashboard/ holds no files: the page is what the judge reads');
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const bytes = readFileSync(join(out, 'screenshots', name));
  if (bytes.length > SHOT_MAX_BYTES) fail(`screenshots/${name} is ${bytes.length} bytes, over the 512 KiB cap`);
  const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b);
  const isJpeg = JPEG_MAGIC.every((b, i) => bytes[i] === b);
  if (!isPng && !isJpeg) fail(`screenshots/${name} is neither a whole PNG nor a whole JPEG`);
}

// The dossier is written last, from this /output, with exactly the scorer's caps. The caps only
// refuse; only text_max_bytes shapes the bytes, so this is what the scorer compares byte for byte.
// No fallback: if buildDossier refuses, the entry is not handed in.
let dossier: Uint8Array;
try {
  dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES });
} catch (err) {
  fail(`buildDossier refused the output: ${err instanceof Error ? err.message : String(err)}`);
}
writeFileSync(join(out, 'dossier.json'), dossier);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossier.length} bytes)\n`,
);
