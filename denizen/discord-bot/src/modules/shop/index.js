'use strict';

/**
 * Denizen Credits shop — spend loop for the economy module's wallet.
 * `,shop` to browse, `,buy <itemId>` to purchase, `,inv` to see what you own.
 */

const fs = require('fs');
const path = require('path');
const { successEmbed, dangerEmbed, baseEmbed, BRAND } = require('../../core/ui-kit');
const { WalletStore } = require('../../core/wallet-store');
const { CATALOG, getItem } = require('./catalog');

const DEFAULT_DIR = path.join(__dirname, '..', '..', '..', 'data', 'shop');

/**
 * Tiny per-guild JSON store for cosmetic ownership: { owned: { userId: [itemId] } }.
 * Used only as a fallback — if the wallet ever grows getInv/addItem this module
 * will prefer that instead, so we don't fight the wallet-store owner over schema.
 */
class ShopStore {
  constructor(opts = {}) {
    this.dir = opts.dir || process.env.DISCORD_SHOP_DIR || DEFAULT_DIR;
    fs.mkdirSync(this.dir, { recursive: true });
    /** @type {Map<string, object>} */
    this.cache = new Map();
  }

  _file(guildId) {
    return path.join(this.dir, `${String(guildId)}.json`);
  }

  load(guildId) {
    const id = String(guildId);
    if (this.cache.has(id)) return this.cache.get(id);
    let data = { owned: {} };
    const file = this._file(id);
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        data = { owned: parsed.owned || {} };
      } catch (err) {
        console.warn('[shop-store] corrupt', id, err.message);
        data = { owned: {} };
      }
    }
    this.cache.set(id, data);
    return data;
  }

  save(guildId) {
    const id = String(guildId);
    const data = this.load(id);
    const file = this._file(id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return data;
  }

  getOwned(guildId, userId) {
    const data = this.load(guildId);
    return Array.isArray(data.owned[String(userId)]) ? data.owned[String(userId)] : [];
  }

  isOwned(guildId, userId, itemId) {
    return this.getOwned(guildId, userId).includes(itemId);
  }

  addOwned(guildId, userId, itemId) {
    const data = this.load(guildId);
    const uid = String(userId);
    data.owned[uid] = data.owned[uid] || [];
    if (!data.owned[uid].includes(itemId)) data.owned[uid].push(itemId);
    this.save(guildId);
    return data.owned[uid];
  }
}

function formatCredits(n) {
  return `**${Number(n).toLocaleString()}** credits`;
}

function shopEmbed() {
  const lines = CATALOG.map(
    (item) => `${item.emoji} **${item.name}** — \`${item.id}\` — ${formatCredits(item.price)}\n_${item.description}_`,
  );
  return baseEmbed({
    color: BRAND.primary,
    title: '🛒 Credits shop',
    description: lines.join('\n\n'),
    footerExtra: 'shop · ,buy <itemId>',
  });
}

function inventoryEmbed(target, ownedIds) {
  if (!ownedIds.length) {
    return baseEmbed({
      color: BRAND.muted,
      title: `${target.username}'s inventory`,
      description: 'Nothing owned yet — check `,shop` and `,buy <itemId>`.',
      footerExtra: 'shop',
    });
  }
  const lines = ownedIds.map((id) => {
    const item = getItem(id);
    return item ? `${item.emoji} **${item.name}** — \`${item.id}\`` : `❔ \`${id}\``;
  });
  return baseEmbed({
    color: BRAND.success,
    title: `${target.username}'s inventory`,
    description: lines.join('\n'),
    footerExtra: 'shop',
  });
}

function createShop(deps) {
  const { config, tracker } = deps;
  const wallet = deps.wallet || new WalletStore();
  deps.wallet = wallet;

  // Prefer wallet-native inventory methods if/when they exist so we never
  // maintain two competing sources of truth for cosmetic ownership.
  const hasWalletInv = typeof wallet.getInv === 'function' && typeof wallet.addItem === 'function';
  const localStore = hasWalletInv ? null : (deps.shopStore || new ShopStore());
  if (!hasWalletInv) deps.shopStore = localStore;

  function shopEnabled(guildId) {
    const c = config?.get?.(guildId)?.economy || {};
    return c.enabled !== false;
  }

  function getOwned(guildId, userId) {
    if (hasWalletInv) return wallet.getInv(guildId, userId) || [];
    return localStore.getOwned(guildId, userId);
  }

  function isOwned(guildId, userId, itemId) {
    return getOwned(guildId, userId).includes(itemId);
  }

  function markOwned(guildId, userId, itemId) {
    if (hasWalletInv) return wallet.addItem(guildId, userId, itemId);
    return localStore.addOwned(guildId, userId, itemId);
  }

  function applyPurchaseEffect(guildId, userId, item) {
    if (item.type !== 'flare') return;
    if (!tracker?.isOnMap?.(guildId, userId)) return;
    tracker.setMapAction(guildId, userId, { kind: 'emote', pose: 'wave' }, 6000);
  }

  function register(registry) {
    registry.register({
      name: 'shop',
      description: 'Browse the Credits shop',
      module: 'shop',
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!shopEnabled(ctx.guild.id)) return ctx.reply('Credits are disabled here.');
        return ctx.reply({ embeds: [shopEmbed()] });
      },
    });

    registry.register({
      name: 'buy',
      description: 'Buy an item from the Credits shop',
      module: 'shop',
      options: [
        { type: 3, name: 'item', description: 'Item id, e.g. title_rookie', required: true },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!shopEnabled(ctx.guild.id)) return ctx.reply('Credits are disabled here.');

        const itemId = String(ctx.getString?.('item') || ctx.args?.[0] || '').trim().toLowerCase();
        if (!itemId) return ctx.reply('Usage: `,buy <itemId>` — see `,shop` for ids.');

        const item = getItem(itemId);
        if (!item) {
          return ctx.reply({
            embeds: [dangerEmbed('Unknown item', `No item \`${itemId}\`. Check \`,shop\` for valid ids.`)],
          });
        }

        const { guild, user } = ctx;
        if (isOwned(guild.id, user.id, item.id)) {
          return ctx.reply({
            embeds: [dangerEmbed('Already owned', `You already own **${item.name}**.`)],
          });
        }

        const balance = wallet.getBalance(guild.id, user.id);
        if (balance < item.price) {
          return ctx.reply({
            embeds: [dangerEmbed(
              'Not enough credits',
              `**${item.name}** costs ${formatCredits(item.price)}. Your balance: ${formatCredits(balance)}.`,
            )],
          });
        }

        const newBalance = wallet.add(guild.id, user.id, -item.price, { reason: 'shop_buy', item: item.id });
        markOwned(guild.id, user.id, item.id);
        applyPurchaseEffect(guild.id, user.id, item);

        return ctx.reply({
          embeds: [successEmbed(
            'Purchased',
            `${item.emoji} You bought **${item.name}**! Balance: ${formatCredits(newBalance)}.`,
          )],
        });
      },
    });

    registry.register({
      name: 'inv',
      description: 'View your Credits shop inventory',
      module: 'shop',
      aliases: ['inventory'],
      options: [
        { type: 6, name: 'user', description: 'Whose inventory to check', required: false },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!shopEnabled(ctx.guild.id)) return ctx.reply('Credits are disabled here.');
        const target = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.() || ctx.user;
        const owned = getOwned(ctx.guild.id, target.id);
        return ctx.reply({ embeds: [inventoryEmbed(target, owned)] });
      },
    });
  }

  return {
    register,
    getOwned,
    isOwned,
  };
}

module.exports = { createShop, ShopStore };
