export type MarketSource = 'birdeye' | 'rwa_xyz' | 'clickhouse_trades';

export interface TokenExtensions {
    coingeckoId?: string;
    website?: string;
    twitter?: string;
    discord?: string;
    telegram?: string;
    description?: string;
    github?: string;
}

export interface ProviderMarketMetrics {
    source?: MarketSource;
    symbol?: string;
    name?: string;
    decimals?: number;
    logoURI?: string;
    price?: number;
    liquidity?: number;
    volume1hUSD?: number;
    volume24hUSD?: number;
    trade1h?: number;
    trade24h?: number;
    uniqueWallet1h?: number;
    uniqueWallet24h?: number;
    marketCap?: number;
    fdv?: number;
    priceChange24hPercent?: number;
    priceChange1hPercent?: number;
    holder?: number;
    totalSupply?: number;
    circulatingSupply?: number;
    lastTradeHumanTime?: string;
    lastTradeAt?: number;
    extensions?: TokenExtensions;
    asOf?: number;
    lastFetchedAt?: number;
}

export interface VariantMarketDocLike extends ProviderMarketMetrics {
    mint: string;
    metricsSource?: MarketSource;
    overviewLastFetchedAt?: number;
    birdeyeMetrics?: ProviderMarketMetrics | null;
    rwaMetrics?: ProviderMarketMetrics | null;
    clickhouseMetrics?: ProviderMarketMetrics | null;
}

export interface SelectedMintMarketSnapshot extends ProviderMarketMetrics {
    mint: string;
    source: MarketSource;
    metricsSource?: MarketSource;
    lastFetchedAt: number;
    overviewLastFetchedAt?: number;
}

const MARKET_SOURCES: readonly MarketSource[] = ['birdeye', 'rwa_xyz', 'clickhouse_trades'];
const MAX_CLICKHOUSE_AS_OF_AGE_MS = 10 * 60_000;
const FRESHNESS_DEMOTION_MS = 15 * 60_000;

const NUMBER_FIELDS = [
    'decimals',
    'price',
    'liquidity',
    'volume1hUSD',
    'volume24hUSD',
    'trade1h',
    'trade24h',
    'uniqueWallet1h',
    'uniqueWallet24h',
    'marketCap',
    'fdv',
    'priceChange24hPercent',
    'priceChange1hPercent',
    'holder',
    'totalSupply',
    'circulatingSupply',
    'lastTradeAt',
    'asOf',
    'lastFetchedAt',
] as const;

const STRING_FIELDS = ['symbol', 'name', 'logoURI', 'lastTradeHumanTime'] as const;

type NumberField = (typeof NUMBER_FIELDS)[number];
type StringField = (typeof STRING_FIELDS)[number];

function isMarketSource(value: unknown): value is MarketSource {
    return typeof value === 'string' && (MARKET_SOURCES as readonly string[]).includes(value);
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeExtensions(value: unknown): TokenExtensions | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const fields = value as Record<string, unknown>;
    const out: TokenExtensions = {};
    for (const key of ['coingeckoId', 'website', 'twitter', 'discord', 'telegram', 'description', 'github'] as const) {
        const text = nonEmptyString(fields[key]);
        if (text !== undefined) out[key] = text;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeSnapshot(
    source: MarketSource,
    raw: ProviderMarketMetrics | null | undefined,
): ProviderMarketMetrics | null {
    if (!raw || typeof raw !== 'object') return null;
    const out: ProviderMarketMetrics = { source };
    for (const field of NUMBER_FIELDS) {
        const value = finiteNumber(raw[field]);
        if (value !== undefined) out[field] = value;
    }
    for (const field of STRING_FIELDS) {
        const value = nonEmptyString(raw[field]);
        if (value !== undefined) out[field] = value;
    }
    const extensions = normalizeExtensions(raw.extensions);
    if (extensions !== undefined) out.extensions = extensions;
    return hasAnySnapshotValue(out) ? out : null;
}

function legacySnapshotForSource(doc: VariantMarketDocLike, source: MarketSource): ProviderMarketMetrics | null {
    if (doc.source !== source && doc.metricsSource !== source) return null;

    const sourceOwnsActivity =
        doc.metricsSource === source ||
        doc.metricsSource === undefined ||
        (source === 'clickhouse_trades' && doc.metricsSource === 'clickhouse_trades');

    const out: ProviderMarketMetrics = { source };

    if (doc.source === source) {
        for (const field of ['symbol', 'name', 'logoURI', 'lastTradeHumanTime'] as const) {
            const value = nonEmptyString(doc[field]);
            if (value !== undefined) out[field] = value;
        }
        const decimals = finiteNumber(doc.decimals);
        if (decimals !== undefined) out.decimals = decimals;
        const extensions = normalizeExtensions(doc.extensions);
        if (extensions !== undefined) out.extensions = extensions;
    }

    if (sourceOwnsActivity) {
        for (const field of [
            'price',
            'volume1hUSD',
            'volume24hUSD',
            'trade1h',
            'trade24h',
            'uniqueWallet1h',
            'uniqueWallet24h',
            'priceChange24hPercent',
            'priceChange1hPercent',
            'lastTradeAt',
            'asOf',
        ] as const) {
            const value = finiteNumber(doc[field]);
            if (value !== undefined) out[field] = value;
        }
    }

    if (doc.source === source) {
        for (const field of ['liquidity', 'marketCap', 'fdv', 'holder', 'totalSupply', 'circulatingSupply'] as const) {
            const value = finiteNumber(doc[field]);
            if (value !== undefined) out[field] = value;
        }
    }

    const lastFetchedAt =
        source === 'birdeye'
            ? (finiteNumber(doc.overviewLastFetchedAt) ?? finiteNumber(doc.lastFetchedAt))
            : finiteNumber(doc.lastFetchedAt);
    if (lastFetchedAt !== undefined) out.lastFetchedAt = lastFetchedAt;

    return hasAnySnapshotValue(out) ? out : null;
}

function hasAnySnapshotValue(snapshot: ProviderMarketMetrics): boolean {
    for (const field of NUMBER_FIELDS) {
        if (field === 'lastFetchedAt') continue;
        if (snapshot[field] !== undefined) return true;
    }
    for (const field of STRING_FIELDS) {
        if (snapshot[field] !== undefined) return true;
    }
    if (snapshot.extensions !== undefined) return true;
    return snapshot.lastFetchedAt !== undefined;
}

function mergeSnapshots(
    source: MarketSource,
    primary: ProviderMarketMetrics | null,
    legacy: ProviderMarketMetrics | null,
): ProviderMarketMetrics | null {
    if (!primary && !legacy) return null;
    return {
        source,
        ...(legacy ?? {}),
        ...(primary ?? {}),
    };
}

function isUsableClickhouseSnapshot(snapshot: ProviderMarketMetrics | null): boolean {
    if (!snapshot) return false;
    if (snapshot.source !== 'clickhouse_trades') return true;
    const asOf = finiteNumber(snapshot.asOf);
    const lastFetchedAt = finiteNumber(snapshot.lastFetchedAt);
    if (asOf === undefined || lastFetchedAt === undefined) return true;
    // snapshots.asOf is stored in epoch-seconds (see crons.clickhouse.ts), while
    // lastFetchedAt is epoch-ms (deps.now()). Convert asOf to ms before comparing
    // so a just-fetched snapshot is never mistaken for stale (previously the ms-
    // seconds difference (~1.75e12) always exceeded the 600s budget).
    return lastFetchedAt - asOf * 1000 <= MAX_CLICKHOUSE_AS_OF_AGE_MS;
}

function demoteStaleSnapshots(snapshots: Array<ProviderMarketMetrics | null>): Array<ProviderMarketMetrics | null> {
    const times = snapshots.map(snapshot => (snapshot ? finiteNumber(snapshot.lastFetchedAt) : undefined));
    const finiteTimes = times.filter((time): time is number => time !== undefined);
    if (finiteTimes.length < 2) return snapshots;
    const newest = Math.max(...finiteTimes);
    const fresh: Array<ProviderMarketMetrics | null> = [];
    const stale: Array<ProviderMarketMetrics | null> = [];
    snapshots.forEach((snapshot, index) => {
        const time = times[index];
        const isStale = snapshot !== null && time !== undefined && newest - time > FRESHNESS_DEMOTION_MS;
        (isStale ? stale : fresh).push(snapshot);
    });
    return stale.length > 0 ? [...fresh, ...stale] : snapshots;
}

function pickNumber(field: NumberField, snapshots: Array<ProviderMarketMetrics | null>): number | undefined {
    for (const snapshot of snapshots) {
        const value = snapshot ? finiteNumber(snapshot[field]) : undefined;
        if (value !== undefined) return value;
    }
    return undefined;
}

function pickString(field: StringField, snapshots: Array<ProviderMarketMetrics | null>): string | undefined {
    for (const snapshot of snapshots) {
        const value = snapshot ? nonEmptyString(snapshot[field]) : undefined;
        if (value !== undefined) return value;
    }
    return undefined;
}

function pickExtensions(snapshots: Array<ProviderMarketMetrics | null>): TokenExtensions | undefined {
    for (const snapshot of snapshots) {
        const value = normalizeExtensions(snapshot?.extensions);
        if (value !== undefined) return value;
    }
    return undefined;
}

function sourceForNumber(field: NumberField, snapshots: Array<ProviderMarketMetrics | null>): MarketSource | undefined {
    for (const snapshot of snapshots) {
        if (!snapshot?.source) continue;
        if (finiteNumber(snapshot[field]) !== undefined) return snapshot.source;
    }
    return undefined;
}

function sourceWithAny(
    fields: readonly NumberField[],
    snapshots: Array<ProviderMarketMetrics | null>,
): MarketSource | undefined {
    for (const snapshot of snapshots) {
        if (!snapshot?.source) continue;
        if (fields.some(field => finiteNumber(snapshot[field]) !== undefined)) return snapshot.source;
    }
    return undefined;
}

function assignNumber(
    out: SelectedMintMarketSnapshot,
    field: NumberField,
    snapshots: Array<ProviderMarketMetrics | null>,
) {
    const value = pickNumber(field, snapshots);
    if (value !== undefined) out[field] = value;
}

function assignString(
    out: SelectedMintMarketSnapshot,
    field: StringField,
    snapshots: Array<ProviderMarketMetrics | null>,
) {
    const value = pickString(field, snapshots);
    if (value !== undefined) out[field] = value;
}

export function selectMintMarketSnapshot(doc: VariantMarketDocLike): SelectedMintMarketSnapshot {
    const birdeye = mergeSnapshots(
        'birdeye',
        normalizeSnapshot('birdeye', doc.birdeyeMetrics),
        legacySnapshotForSource(doc, 'birdeye'),
    );
    const rwa = mergeSnapshots(
        'rwa_xyz',
        normalizeSnapshot('rwa_xyz', doc.rwaMetrics),
        legacySnapshotForSource(doc, 'rwa_xyz'),
    );
    const clickhouseRaw = mergeSnapshots(
        'clickhouse_trades',
        normalizeSnapshot('clickhouse_trades', doc.clickhouseMetrics),
        legacySnapshotForSource(doc, 'clickhouse_trades'),
    );
    const clickhouse = isUsableClickhouseSnapshot(clickhouseRaw) ? clickhouseRaw : null;

    const legacyRaw = normalizeSnapshot(isMarketSource(doc.source) ? doc.source : 'birdeye', doc);
    const legacy =
        doc.metricsSource === 'clickhouse_trades' || !isUsableClickhouseSnapshot(legacyRaw) ? null : legacyRaw;
    const identityOrder = [birdeye, rwa, clickhouse, legacy];
    const priceOrder = demoteStaleSnapshots([birdeye, rwa, clickhouse, legacy]);
    const activityOrder = demoteStaleSnapshots([birdeye, clickhouse, legacy]);
    const overviewOrder = [birdeye, rwa, legacy];

    const selectedSource =
        sourceWithAny(['price', 'liquidity', 'marketCap', 'fdv', 'holder', 'totalSupply'], identityOrder) ??
        (isMarketSource(doc.source) ? doc.source : undefined) ??
        'birdeye';
    const metricsSource =
        sourceForNumber('price', priceOrder) ??
        sourceForNumber('volume24hUSD', activityOrder) ??
        sourceWithAny(['volume1hUSD', 'trade1h', 'trade24h', 'uniqueWallet1h', 'uniqueWallet24h'], activityOrder) ??
        (isMarketSource(doc.metricsSource) ? doc.metricsSource : undefined);
    const selectedLastFetchedAt =
        pickNumber('lastFetchedAt', [
            metricsSource === 'birdeye' ? birdeye : null,
            metricsSource === 'rwa_xyz' ? rwa : null,
            metricsSource === 'clickhouse_trades' ? clickhouse : null,
            birdeye,
            rwa,
            clickhouse,
            legacy,
        ]) ??
        finiteNumber(doc.lastFetchedAt) ??
        Date.now();

    const out: SelectedMintMarketSnapshot = {
        mint: doc.mint,
        source: selectedSource,
        lastFetchedAt: selectedLastFetchedAt,
        ...(metricsSource ? { metricsSource } : {}),
    };

    for (const field of ['symbol', 'name', 'logoURI'] as const) assignString(out, field, identityOrder);
    assignNumber(out, 'decimals', identityOrder);

    assignNumber(out, 'price', priceOrder);
    assignNumber(out, 'liquidity', overviewOrder);
    assignNumber(out, 'volume1hUSD', activityOrder);
    assignNumber(out, 'volume24hUSD', activityOrder);
    assignNumber(out, 'trade1h', activityOrder);
    assignNumber(out, 'trade24h', activityOrder);
    assignNumber(out, 'uniqueWallet1h', activityOrder);
    assignNumber(out, 'uniqueWallet24h', activityOrder);
    assignNumber(out, 'marketCap', overviewOrder);
    assignNumber(out, 'fdv', [birdeye, legacy]);
    assignNumber(out, 'priceChange24hPercent', activityOrder);
    assignNumber(out, 'priceChange1hPercent', activityOrder);
    assignNumber(out, 'holder', overviewOrder);
    assignNumber(out, 'totalSupply', overviewOrder);
    assignNumber(out, 'circulatingSupply', overviewOrder);
    assignString(out, 'lastTradeHumanTime', [birdeye, legacy]);
    assignNumber(out, 'lastTradeAt', activityOrder);

    if (out.metricsSource === 'clickhouse_trades') assignNumber(out, 'asOf', [clickhouse, legacy]);

    const extensions = pickExtensions([birdeye, legacy]);
    if (extensions !== undefined) out.extensions = extensions;
    const overviewLastFetchedAt = finiteNumber(doc.overviewLastFetchedAt);
    if (overviewLastFetchedAt !== undefined) out.overviewLastFetchedAt = overviewLastFetchedAt;

    return out;
}
