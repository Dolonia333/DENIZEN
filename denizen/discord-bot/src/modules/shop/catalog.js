'use strict';

/**
 * Denizen Credits shop — item catalog.
 * Kept small on purpose: a few vanity titles, a map flare, and an emote unlock.
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   price: number,
 *   emoji: string,
 *   type: 'title'|'flare'|'unlock',
 *   description: string,
 * }} ShopItem
 */

/** @type {ShopItem[]} */
const CATALOG = [
  {
    id: 'title_rookie',
    name: 'Rookie',
    price: 50,
    emoji: '🔰',
    type: 'title',
    description: 'A starter vanity title for your wallet card.',
  },
  {
    id: 'title_duelist',
    name: 'Duelist',
    price: 150,
    emoji: '⚔️',
    type: 'title',
    description: 'Show off your PVP credentials.',
  },
  {
    id: 'title_tycoon',
    name: 'Tycoon',
    price: 400,
    emoji: '💰',
    type: 'title',
    description: 'For the Credits leaderboard regulars.',
  },
  {
    id: 'flare_gold',
    name: 'Gold Flare',
    price: 200,
    emoji: '✨',
    type: 'flare',
    description: 'A one-time golden wave on the Spaces map, plus a permanent flare unlock.',
  },
  {
    id: 'emote_pack',
    name: 'Emote Pack',
    price: 100,
    emoji: '🎭',
    type: 'unlock',
    description: 'Unlocks a bonus set of map emotes to flex in Spaces.',
  },
];

/** @type {Map<string, ShopItem>} */
const CATALOG_BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

function getItem(itemId) {
  return CATALOG_BY_ID.get(String(itemId || '').toLowerCase()) || null;
}

module.exports = {
  CATALOG,
  getItem,
};
