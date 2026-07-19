'use strict';

/**
 * Discord → map emote/eat catalog (Pixel Platter + NPC poses).
 * Shared by ,eat and messageReactionAdd.
 */

/** Short alias → Phaser texture key (matches discord-map FOOD_KEYS). */
const FOOD_ALIASES = {
  burger: 'foodBurger',
  pizza: 'foodPizza',
  fries: 'foodFries',
  frenchfries: 'foodFries',
  hotdog: 'foodHotdog',
  hotdogplain: 'foodHotdogPlain',
  cake: 'foodCake',
  tiramisu: 'foodTiramisu',
  pie: 'foodPie',
  macarons: 'foodMacarons',
  macaron: 'foodMacarons',
  icecream: 'foodIceCream',
  ice: 'foodIceCream',
  soda: 'foodSoda',
  creme: 'foodCreme',
  cremebrulee: 'foodCreme',
  apple: 'foodApple',
  banana: 'foodBanana',
  strawberry: 'foodStrawberry',
  cherry: 'foodCherry',
  grapes: 'foodGrapes',
  kiwi: 'foodKiwi',
  lemon: 'foodLemon',
  orange: 'foodOrange',
  pear: 'foodPear',
  raspberry: 'foodRaspberry',
};

/** Slash / help list — Discord allows max 25 choices. */
const FOOD_CHOICES = Object.keys(FOOD_ALIASES)
  .filter((k) => !['frenchfries', 'hotdogplain', 'macaron', 'ice', 'cremebrulee'].includes(k))
  .slice(0, 25)
  .map((name) => ({ name, value: name }));

const FOOD_KEYS = [...new Set(Object.values(FOOD_ALIASES))];

/**
 * @param {string} raw
 * @returns {{ ok: true, key: string, alias: string } | { ok: false, error: string }}
 */
function resolveFood(raw) {
  const alias = String(raw || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!alias) {
    const keys = Object.keys(FOOD_ALIASES);
    const pick = keys[Math.floor(Math.random() * keys.length)];
    return { ok: true, key: FOOD_ALIASES[pick], alias: pick };
  }
  if (FOOD_ALIASES[alias]) return { ok: true, key: FOOD_ALIASES[alias], alias };
  if (FOOD_KEYS.includes(alias) || FOOD_KEYS.includes(`food${alias.charAt(0).toUpperCase()}${alias.slice(1)}`)) {
    const key = FOOD_KEYS.includes(alias) ? alias : `food${alias.charAt(0).toUpperCase()}${alias.slice(1)}`;
    return { ok: true, key, alias };
  }
  const list = Object.keys(FOOD_ALIASES)
    .filter((k) => !['frenchfries', 'hotdogplain', 'macaron', 'ice', 'cremebrulee'].includes(k))
    .join(', ');
  return { ok: false, error: `Unknown food. Try: ${list}` };
}

/** Discord reaction name / unicode → map action. */
const REACTION_BY_TOKEN = {
  // Emotes
  wave: { kind: 'emote', pose: 'wave' },
  '👋': { kind: 'emote', pose: 'wave' },
  raised_hand: { kind: 'emote', pose: 'wave' },
  '✋': { kind: 'emote', pose: 'wave' },
  hello: { kind: 'emote', pose: 'wave' },
  shrug: { kind: 'emote', pose: 'shrug' },
  person_shrugging: { kind: 'emote', pose: 'shrug' },
  '🤷': { kind: 'emote', pose: 'shrug' },
  '🤷‍♂️': { kind: 'emote', pose: 'shrug' },
  '🤷‍♀️': { kind: 'emote', pose: 'shrug' },
  joy: { kind: 'emote', pose: 'snicker' },
  '😂': { kind: 'emote', pose: 'snicker' },
  laughing: { kind: 'emote', pose: 'snicker' },
  '😆': { kind: 'emote', pose: 'snicker' },
  rofl: { kind: 'emote', pose: 'snicker' },
  '🤣': { kind: 'emote', pose: 'snicker' },
  grin: { kind: 'emote', pose: 'snicker' },
  dash: { kind: 'emote', pose: 'jump' },
  '💨': { kind: 'emote', pose: 'jump' },
  zap: { kind: 'emote', pose: 'jump' },
  '⚡': { kind: 'emote', pose: 'jump' },
  broken_heart: { kind: 'emote', pose: 'hurt' },
  '💔': { kind: 'emote', pose: 'hurt' },
  heart: { kind: 'emote', pose: 'wave' },
  '❤️': { kind: 'emote', pose: 'wave' },
  '❤': { kind: 'emote', pose: 'wave' },
  '♥️': { kind: 'emote', pose: 'wave' },
  // Food shortcuts
  pizza: { kind: 'eat', pose: 'eat', food: 'foodPizza' },
  '🍕': { kind: 'eat', pose: 'eat', food: 'foodPizza' },
  hamburger: { kind: 'eat', pose: 'eat', food: 'foodBurger' },
  '🍔': { kind: 'eat', pose: 'eat', food: 'foodBurger' },
  fries: { kind: 'eat', pose: 'eat', food: 'foodFries' },
  '🍟': { kind: 'eat', pose: 'eat', food: 'foodFries' },
  hotdog: { kind: 'eat', pose: 'eat', food: 'foodHotdog' },
  '🌭': { kind: 'eat', pose: 'eat', food: 'foodHotdog' },
  cake: { kind: 'eat', pose: 'eat', food: 'foodCake' },
  '🍰': { kind: 'eat', pose: 'eat', food: 'foodCake' },
  pie: { kind: 'eat', pose: 'eat', food: 'foodPie' },
  '🥧': { kind: 'eat', pose: 'eat', food: 'foodPie' },
  ice_cream: { kind: 'eat', pose: 'eat', food: 'foodIceCream' },
  icecream: { kind: 'eat', pose: 'eat', food: 'foodIceCream' },
  '🍦': { kind: 'eat', pose: 'eat', food: 'foodIceCream' },
  '🍨': { kind: 'eat', pose: 'eat', food: 'foodIceCream' },
  cup_with_straw: { kind: 'eat', pose: 'eat', food: 'foodSoda' },
  '🥤': { kind: 'eat', pose: 'eat', food: 'foodSoda' },
  apple: { kind: 'eat', pose: 'eat', food: 'foodApple' },
  '🍎': { kind: 'eat', pose: 'eat', food: 'foodApple' },
  green_apple: { kind: 'eat', pose: 'eat', food: 'foodApple' },
  banana: { kind: 'eat', pose: 'eat', food: 'foodBanana' },
  '🍌': { kind: 'eat', pose: 'eat', food: 'foodBanana' },
  strawberry: { kind: 'eat', pose: 'eat', food: 'foodStrawberry' },
  '🍓': { kind: 'eat', pose: 'eat', food: 'foodStrawberry' },
  cherries: { kind: 'eat', pose: 'eat', food: 'foodCherry' },
  '🍒': { kind: 'eat', pose: 'eat', food: 'foodCherry' },
  grapes: { kind: 'eat', pose: 'eat', food: 'foodGrapes' },
  '🍇': { kind: 'eat', pose: 'eat', food: 'foodGrapes' },
  kiwi: { kind: 'eat', pose: 'eat', food: 'foodKiwi' },
  kiwifruit: { kind: 'eat', pose: 'eat', food: 'foodKiwi' },
  '🥝': { kind: 'eat', pose: 'eat', food: 'foodKiwi' },
  lemon: { kind: 'eat', pose: 'eat', food: 'foodLemon' },
  '🍋': { kind: 'eat', pose: 'eat', food: 'foodLemon' },
  tangerine: { kind: 'eat', pose: 'eat', food: 'foodOrange' },
  orange: { kind: 'eat', pose: 'eat', food: 'foodOrange' },
  '🍊': { kind: 'eat', pose: 'eat', food: 'foodOrange' },
  pear: { kind: 'eat', pose: 'eat', food: 'foodPear' },
  '🍐': { kind: 'eat', pose: 'eat', food: 'foodPear' },
};

/**
 * @param {{ name?: string|null, id?: string|null }|string|null} emoji
 * @returns {{ kind: string, pose?: string, food?: string }|null}
 */
function actionFromReaction(emoji) {
  if (!emoji) return null;
  if (typeof emoji === 'string') {
    return REACTION_BY_TOKEN[emoji] || REACTION_BY_TOKEN[emoji.toLowerCase()] || null;
  }
  const name = emoji.name || '';
  if (name && REACTION_BY_TOKEN[name]) return REACTION_BY_TOKEN[name];
  const lower = String(name).toLowerCase();
  if (REACTION_BY_TOKEN[lower]) return REACTION_BY_TOKEN[lower];
  // Food alias via custom emoji name e.g. :pizza:
  const food = resolveFood(lower);
  if (food.ok && FOOD_ALIASES[food.alias]) {
    return { kind: 'eat', pose: 'eat', food: food.key };
  }
  return null;
}

module.exports = {
  FOOD_ALIASES,
  FOOD_CHOICES,
  FOOD_KEYS,
  resolveFood,
  actionFromReaction,
  REACTION_BY_TOKEN,
};
