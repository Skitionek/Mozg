'use strict';

/**
 * CoinGecko – free cryptocurrency data API.
 * Reference: https://www.coingecko.com/api/documentation
 *
 * No credentials required for the free public endpoints used here.
 * Rate limits apply on the free tier (10–30 req/min).
 *
 * Usage notes:
 *  - /coins/markets requires `vs_currency` query param (e.g. usd).
 *    Pass it via `where: { vs_currency: "usd" }`.
 *  - /exchanges/{id} accepts the exchange id (e.g. "binance").
 *
 * Relationship map:
 *  - /asset_platforms  → /coins/list  (native_coin_id FK, belongsTo)
 *  - /coins/list       → /asset_platforms (platforms map keys are platform IDs)
 *  - /coins/markets    → /asset_platforms (via atl_change_percentage, conceptual)
 */
module.exports = {
  name: 'coingecko',
  label: 'CoinGecko (REST)',
  description: 'Free cryptocurrency data API with coin listings, market data, exchanges and asset platforms.',
  driver: 'rest',
  connection: {
    database: 'https://api.coingecko.com/api/v3',
  },
  entities: [
    {
      name: '/coins/list',
      columns: ['id', 'symbol', 'name', 'platforms'],
      relations: [
        { entity: '/asset_platforms', foreignKey: 'id', type: 'hasMany', alias: 'platforms' },
      ],
    },
    {
      name: '/coins/markets',
      columns: ['id', 'symbol', 'name', 'image', 'current_price', 'market_cap', 'market_cap_rank', 'total_volume', 'high_24h', 'low_24h', 'price_change_percentage_24h', 'circulating_supply', 'total_supply', 'max_supply'],
      relations: [],
    },
    {
      name: '/exchanges',
      columns: ['id', 'name', 'year_established', 'country', 'description', 'url', 'image', 'has_trading_incentive', 'trust_score', 'trust_score_rank', 'trade_volume_24h_btc'],
      relations: [],
    },
    {
      name: '/asset_platforms',
      columns: ['id', 'chain_identifier', 'name', 'shortname', 'native_coin_id'],
      relations: [
        { entity: '/coins/list', foreignKey: 'native_coin_id', type: 'belongsTo', alias: 'nativeCoin' },
      ],
    },
    {
      name: '/coins/categories/list',
      columns: ['category_id', 'name'],
      relations: [],
    },
  ],
};
