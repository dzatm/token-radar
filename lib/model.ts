// Token Radar's model, radar-2: one sealed snapshot in, one ranked board out.
//
// The board covers every slug on the snapshot's watchlist (the floor, never a ceiling) and adds the
// strongest pre-token protocols below the floor, by TVL. A protocol is pre-token when its record
// carries no token at all (no market cap, no CoinGecko id, no symbol); the live-token protocols are
// kept apart and shown with the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   base     = tvl_usd x 0.25
//   growth   = clamp(change_7d, -80, 150) per cent (null change counts as 0)
//   growth   = 1 + (growth / 100) x 0.6
//   maturity = 0.65 + min(age_days, 1095) / 1095 x 0.35   (age unknown: 365 days)
//   youth    = 0.85 when the protocol was listed under 90 days ago, else 1
//   chains   = 1 + 0.02 per chain past the first, at most four extra
//   sector   = RWA 1.15, Risk Curators / Capital Allocators 1.10, Yield / Basis 1.05,
//              Derivatives 0.95, anything else 1.00
//   implied  = max(1, round(base x growth x maturity x youth x chains x sector))
//
// The dashboard recomputes every row from the same figures and shows the check, so the page's
// arithmetic and the board's data are visibly the same. No protocol name is ever special-cased: the
// same function scores every row. When two rows compute the same whole-dollar value, the lower one
// steps down one dollar so the ranking is a ranking; the breakdown says so.

/** One protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** radar-2's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelParams {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  youth_days: number;
  youth_factor: number;
  chain_bonus: number;
  chain_max: number;
}

export const RADAR2: ModelParams = {
  base_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -80,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  youth_days: 90,
  youth_factor: 0.85,
  chain_bonus: 0.02,
  chain_max: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** Pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** Live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    youth_multiplier: number;
    chain_multiplier: number;
    sector_multiplier: number;
    sector: string;
    computed_value_usd: number;
    tie_break_usd: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  youth_multiplier: number;
  chain_multiplier: number;
  sector_multiplier: number;
  sector: string;
  computed_value_usd: number;
  tie_break_usd: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A sector's multiplier and its display label, from the category alone. */
export function sectorOf(category: string | null): { mult: number; label: string } {
  const c = (category ?? '').toLowerCase();
  if (c.includes('rwa')) return { mult: 1.15, label: 'RWA' };
  if (c.includes('risk curator')) return { mult: 1.1, label: 'Risk Curators' };
  if (c.includes('capital allocator') || c.includes('onchain capital')) return { mult: 1.1, label: 'Capital Allocators' };
  if (c.includes('yield') || c.includes('basis')) return { mult: 1.05, label: 'Yield / Basis' };
  if (c.includes('derivative') || c.includes('perpetual')) return { mult: 0.95, label: 'Derivatives' };
  return { mult: 1, label: 'Other' };
}

/** Every multiplier and the implied value one protocol gets under `params`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  params: ModelParams,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  youthMult: number;
  chainMult: number;
  sectorMult: number;
  sector: string;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(params.growth_cap, Math.max(params.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * params.growth_weight;
  const ageForModel = age ?? params.unknown_age_days;
  const maturityMult =
    params.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), params.maturity_days) / params.maturity_days) * params.maturity_range;
  const youthMult = age !== null && age < params.youth_days ? params.youth_factor : 1;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), params.chain_max);
  const chainMult = 1 + extraChains * params.chain_bonus;
  const sector = sectorOf(protocol.category);
  const base = protocol.tvl_usd * params.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * youthMult * chainMult * sector.mult));
  return { implied, growthPct, growthMult, maturityMult, youthMult, chainMult, sectorMult: sector.mult, sector: sector.label, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The board: every watchlist slug plus the strongest pre-token protocols below the floor. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = RADAR2): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, params) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // A ranking ranks: where two rows compute the same whole-dollar value, the lower one steps down
  // one dollar, and the breakdown records the step so the detail view stays honest about it.
  let previous = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    let value = s.implied;
    let tieBreak = 0;
    if (value >= previous) {
      tieBreak = value - (previous - 1);
      value = previous - 1;
    }
    previous = value;
    const steps = farmSteps(s.p, s.age);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: value,
      model: {
        base_multiple: params.base_multiple,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        youth_multiplier: s.youthMult,
        chain_multiplier: round4(s.chainMult),
        sector_multiplier: s.sectorMult,
        sector: s.sector,
        computed_value_usd: s.implied,
        tie_break_usd: tieBreak,
        age_days: s.age,
      },
      farm_steps: steps.map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One step as a single string: the action, then its cost and time, inside the gate's 20..600 chars. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page for updates.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} on ${chain} and leave the loan open.`;
  if (c.includes('liquid staking') || c.includes('restak')) return `Stake $${capital} of the chain's asset with ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave it in place.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} of USDC into a ${name} yield vault on ${chain} and keep the vault shares.`;
  if (c.includes('yield') || c.includes('basis')) return `Deposit $${capital} into ${name}'s yield strategy on ${chain} and let it compound.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC into ${chain} with ${name}, then put the bridged funds to work in its app.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in a ${name} market on ${chain}.`;
  if (c.includes('risk curator') || c.includes('capital allocator')) return `Allocate $${capital} to a ${name} curator vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or lock $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Buy $${capital} of ${name}'s tokenised yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('launchpad')) return `Commit $${capital} to a ${name} launch on ${chain} and hold the allocation.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('nft')) return `Lend $${capital} against an NFT position on ${name} on ${chain} and keep the loan open.`;
  if (c.includes('gaming') || c.includes('social') || c.includes('payment')) return `Spend $${capital} inside ${name} on ${chain} and keep using the app each week.`;
  if (c.includes('oracle')) return `Stake $${capital} with a ${name} data feed on ${chain} and keep the stake bonded.`;
  return `Put $${capital} of USDC to work in ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly action: the habit that keeps the farm counting. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return `Repay a little of the loan and borrow it back, so the position moves every week.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap a small amount through the pool and add the proceeds back to the position.`;
  if (c.includes('liquid staking') || c.includes('restak')) return `Claim the staking rewards and restake them instead of selling.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge a small amount back and forth so the route stays active.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close the hedge and open a fresh one at the new price.`;
  if (c.includes('prediction')) return `Settle one market and open the next one.`;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('yield aggregator')) return `Check the vault's allocation and top it up when the mix changes.`;
  if (c.includes('rwa') || c.includes('stable')) return `Reinvest the yield the position pays into the same asset.`;
  if (c.includes('insurance')) return `Renew the cover before it lapses and keep the policy current.`;
  return `Do one real action in the app each week: a deposit, a swap, a vote or a claim.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: weeklyFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    {
      text: `Keep the position open for at least ${hold} days so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    youth_multiplier: row.model.youth_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    sector_multiplier: row.model.sector_multiplier,
    sector: row.model.sector,
    computed_value_usd: row.model.computed_value_usd,
    tie_break_usd: row.model.tie_break_usd,
    on_watchlist: false,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, params: ModelParams = RADAR2): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, params);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: params,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => ({ ...radarRow(r), on_watchlist: snapshot.watchlist.includes(r.slug) })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate wants`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not sit below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
