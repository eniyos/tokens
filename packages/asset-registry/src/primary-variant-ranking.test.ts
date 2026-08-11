import { describe, expect, it } from 'bun:test';
import {
    isSpotLikeVariantKind,
    pickPrimaryVariantWithRanking,
    type PrimaryVariantStrategy,
    type VariantFillQualityRankingSnapshot,
    type VariantMarketRankingSnapshot,
} from './primary-variant-ranking';
import type { AssetVariant, CanonicalAsset } from './types';

const NOW = 1_700_000_000;
const MINT_A = 'So11111111111111111111111111111111111111112';
const MINT_B = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
const MINT_C = 'KeGvyv1D8E7MRcE6x3tmEKkzuZg5c2e4FivF3bKpump';
const MINT_D = '7vfCXTUXxCGDfbA4HgimTXKyt7KS5pJGw1zfKedpump';

function variant(
    mint: string,
    variantId: string,
    trustTier: AssetVariant['trustTier'] = 'tier2',
    stockVariantTier?: AssetVariant['stockVariantTier'],
): AssetVariant {
    return {
        variantId,
        mint,
        kind: 'tokenized_equity',
        trustTier,
        tags: [],
        ...(stockVariantTier ? { stockVariantTier } : {}),
    };
}

function asset(variants: AssetVariant[]): CanonicalAsset {
    return {
        assetId: 'tesla',
        category: 'equity',
        aliases: [],
        variants,
    };
}

function fill(overrides: Partial<VariantFillQualityRankingSnapshot> = {}): VariantFillQualityRankingSnapshot {
    return {
        volume24hUSD: 100_000,
        trade24h: 100,
        flowSourceCount: 2,
        botVolumeRatio: 0.1,
        feeBps: 1,
        executionScore: 50,
        isEligibleForPrimary: true,
        asOf: NOW,
        ...overrides,
    };
}

function market(overrides: Partial<VariantMarketRankingSnapshot> = {}): VariantMarketRankingSnapshot {
    return {
        liquidity: 1_000_000,
        volume24hUSD: 100_000,
        trade24h: 100,
        ...overrides,
    };
}

function pick(params: {
    variants?: AssetVariant[];
    marketByMint: Map<string, VariantMarketRankingSnapshot>;
    fillQualityByMint?: Map<string, VariantFillQualityRankingSnapshot>;
    strategy?: PrimaryVariantStrategy;
    mintRank?: Map<string, number>;
}) {
    return pickPrimaryVariantWithRanking({
        asset: asset(params.variants ?? [variant(MINT_A, 'tesla:ondo'), variant(MINT_B, 'tesla:xstock')]),
        mintRank:
            params.mintRank ??
            new Map([
                [MINT_A, 0],
                [MINT_B, 1],
                [MINT_C, 2],
                [MINT_D, 3],
            ]),
        marketByMint: params.marketByMint,
        fillQualityByMint: params.fillQualityByMint,
        options: { nowSeconds: NOW, strategy: params.strategy },
    }).variant;
}

describe('pickPrimaryVariantWithRanking', () => {
    it('defaults to liquidity strategy', () => {
        const selected = pick({
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 1_000_000 })],
                [MINT_B, market({ liquidity: 900_000 })],
            ]),
            fillQualityByMint: new Map([
                [MINT_A, fill({ executionScore: 40 })],
                [MINT_B, fill({ executionScore: 90 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });

    it('liquidity strategy ignores higher execution score', () => {
        const selected = pick({
            strategy: 'liquidity',
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 2_000_000 })],
                [MINT_B, market({ liquidity: 800_000 })],
            ]),
            fillQualityByMint: new Map([
                [MINT_A, fill({ executionScore: 35 })],
                [MINT_B, fill({ executionScore: 95 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });

    it('execution-quality strategy preserves hybrid override within the liquidity-ratio cap', () => {
        const selected = pick({
            strategy: 'execution_quality',
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 2_000_000 })],
                [MINT_B, market({ liquidity: 800_000 })],
            ]),
            fillQualityByMint: new Map([
                [MINT_A, fill({ executionScore: 35 })],
                [MINT_B, fill({ executionScore: 80 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_B);
    });

    it('execution-quality strategy does not override when the liquidity gap exceeds the cap', () => {
        const selected = pick({
            strategy: 'execution_quality',
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 10_000_000 })],
                [MINT_B, market({ liquidity: 1_000_000 })],
            ]),
            fillQualityByMint: new Map([
                [MINT_A, fill({ executionScore: 35 })],
                [MINT_B, fill({ executionScore: 90 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });

    it('execution-quality strategy does not override when score gap is below threshold', () => {
        const selected = pick({
            strategy: 'execution_quality',
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 1_000_000 })],
                [MINT_B, market({ liquidity: 900_000 })],
            ]),
            fillQualityByMint: new Map([
                [MINT_A, fill({ executionScore: 70 })],
                [MINT_B, fill({ executionScore: 79 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });

    it('filters candidates with low known trade count', () => {
        const selected = pick({
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 2_000_000, trade24h: 3 })],
                [MINT_B, market({ liquidity: 1_000_000, trade24h: 50 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_B);
    });

    it('filters candidates with low known volume', () => {
        const selected = pick({
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 2_000_000, volume24hUSD: 50 })],
                [MINT_B, market({ liquidity: 1_000_000, volume24hUSD: 10_000 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_B);
    });

    it('does not filter candidates solely because activity metrics are missing', () => {
        const selected = pick({
            marketByMint: new Map([
                [MINT_A, { liquidity: 2_000_000 }],
                [MINT_B, market({ liquidity: 1_000_000 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });

    it('falls back when filters would remove every candidate', () => {
        const selected = pick({
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 2_000_000, volume24hUSD: 50, trade24h: 3 })],
                [MINT_B, market({ liquidity: 1_000_000, volume24hUSD: 25, trade24h: 2 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });

    it('filters a robust volume outlier when there are enough samples', () => {
        const selected = pick({
            variants: [variant(MINT_A, 'tesla:a'), variant(MINT_B, 'tesla:b'), variant(MINT_C, 'tesla:c')],
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 10_000_000, volume24hUSD: 100_000 })],
                [MINT_B, market({ liquidity: 2_000_000, volume24hUSD: 110_000 })],
                [MINT_C, market({ liquidity: 1_000_000, volume24hUSD: 100_000_000 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });

    it('filters a robust trade outlier when there are enough samples', () => {
        const selected = pick({
            variants: [variant(MINT_A, 'tesla:a'), variant(MINT_B, 'tesla:b'), variant(MINT_C, 'tesla:c')],
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 10_000_000, trade24h: 100 })],
                [MINT_B, market({ liquidity: 2_000_000, trade24h: 105 })],
                [MINT_C, market({ liquidity: 1_000_000, trade24h: 1_000_000 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });

    it('does not run robust outlier filtering for fewer than three samples', () => {
        const selected = pick({
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 1_000_000, volume24hUSD: 100_000 })],
                [MINT_B, market({ liquidity: 2_000_000, volume24hUSD: 100_000_000 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_B);
    });

    it('uses fill-quality activity as fallback when market activity metrics are missing', () => {
        const selected = pick({
            marketByMint: new Map([
                [MINT_A, { liquidity: 2_000_000 }],
                [MINT_B, market({ liquidity: 1_000_000 })],
            ]),
            fillQualityByMint: new Map([[MINT_A, fill({ volume24hUSD: 50, trade24h: 2 })]]),
        });

        expect(selected?.mint).toBe(MINT_B);
    });

    it('uses lexical tie-break when requested', () => {
        const result = pickPrimaryVariantWithRanking({
            asset: asset([variant(MINT_C, 'tesla:c'), variant(MINT_B, 'tesla:b')]),
            mintRank: new Map(),
            marketByMint: new Map(),
            options: { nowSeconds: NOW, lexicalTieBreak: true },
        });

        expect(result.variant?.mint).toBe(MINT_C < MINT_B ? MINT_C : MINT_B);
    });

    it('lexical tie-break wins over array order when both variants are uncurated', () => {
        // MINT_B is first in the array but lexically LARGER than MINT_C, so the
        // correct lexical answer (MINT_C) differs from the buggy "first candidate"
        // result that an unreachable lexical branch would keep.
        const result = pickPrimaryVariantWithRanking({
            asset: asset([variant(MINT_B, 'tesla:b'), variant(MINT_C, 'tesla:c')]),
            mintRank: new Map(),
            marketByMint: new Map(),
            options: { nowSeconds: NOW, lexicalTieBreak: true },
        });

        expect(result.variant?.mint).toBe(MINT_C);
    });

    it('stock-redeemability strategy picks a share-redeemable variant within the liquidity cap', () => {
        const selected = pick({
            strategy: 'stock_redeemability',
            variants: [
                variant(MINT_A, 'spacex:ondo', 'tier2', 'cash_redeemable'),
                variant(MINT_B, 'spacex:backpack', 'tier2', 'share_redeemable'),
            ],
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 2_000_000 })],
                [MINT_B, market({ liquidity: 600_000 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_B);
    });

    it('stock-redeemability strategy lets liquidity win beyond the override cap', () => {
        const selected = pick({
            strategy: 'stock_redeemability',
            variants: [
                variant(MINT_A, 'spacex:ondo', 'tier2', 'cash_redeemable'),
                variant(MINT_B, 'spacex:backpack', 'tier2', 'share_redeemable'),
            ],
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 6_000_000 })],
                [MINT_B, market({ liquidity: 1_000_000 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });

    it('stock-redeemability strategy treats missing stock tier as not redeemable', () => {
        const selected = pick({
            strategy: 'stock_redeemability',
            variants: [variant(MINT_A, 'spacex:unknown'), variant(MINT_B, 'spacex:xstock', 'tier2', 'cash_redeemable')],
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 1_000_000 })],
                [MINT_B, market({ liquidity: 900_000 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_B);
    });

    it('treats spot as spot-like and etf as not', () => {
        expect(isSpotLikeVariantKind('spot')).toBe(true);
        expect(isSpotLikeVariantKind('etf')).toBe(false);
    });

    it('prefers spot variants over higher-liquidity etf variants for primary selection', () => {
        const spot: AssetVariant = { ...variant(MINT_A, 'gold:pax-gold'), kind: 'spot' };
        const etf: AssetVariant = { ...variant(MINT_B, 'gold:gold-token'), kind: 'etf' };

        const selected = pick({
            variants: [spot, etf],
            marketByMint: new Map([
                [MINT_A, market({ liquidity: 100_000 })],
                [MINT_B, market({ liquidity: 5_000_000 })],
            ]),
        });

        expect(selected?.mint).toBe(MINT_A);
    });
});
