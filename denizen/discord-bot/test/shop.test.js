'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ConfigStore } = require('../src/core/config-store');
const { WalletStore } = require('../src/core/wallet-store');
const { CommandRegistry } = require('../src/core/command-registry');
const { createShop, ShopStore } = require('../src/modules/shop');
const { CATALOG, getItem } = require('../src/modules/shop/catalog');

function tmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-shop-cfg-'));
  return new ConfigStore({ dir });
}

function tmpWallet(startBalance = 500) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-shop-wallet-'));
  return new WalletStore({ dir, startBalance });
}

function tmpShopStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-shop-inv-'));
  return new ShopStore({ dir });
}

function makeCtx({ guildId, userId, args = [], mentionUser = null }) {
  const replies = [];
  return {
    ctx: {
      source: 'prefix',
      guild: { id: guildId, name: 'Test' },
      user: { id: userId, username: `user-${userId}` },
      args,
      message: { mentions: { users: { first: () => mentionUser } } },
      getString: (name) => (name === 'item' ? args[0] || null : args.join(' ') || null),
      getUser: () => mentionUser,
      reply: async (content) => {
        replies.push(content);
        return content;
      },
    },
    replies,
  };
}

function embedText(reply) {
  const embed = reply?.embeds?.[0];
  if (!embed) return typeof reply === 'string' ? reply : reply?.content || '';
  const data = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
  return `${data.title || ''}\n${data.description || ''}`;
}

describe('shop module', () => {
  it('catalog has 4-6 items with positive prices and unique ids', () => {
    assert.ok(CATALOG.length >= 4 && CATALOG.length <= 6);
    const ids = new Set(CATALOG.map((i) => i.id));
    assert.equal(ids.size, CATALOG.length);
    for (const item of CATALOG) {
      assert.ok(item.price > 0);
      assert.ok(getItem(item.id));
    }
  });

  it(',shop lists every catalog item with its price', async () => {
    const config = tmpConfig();
    const wallet = tmpWallet();
    const registry = new CommandRegistry({ prefix: ',' });
    createShop({ config, wallet, shopStore: tmpShopStore() }).register(registry);

    const cmd = registry.get('shop');
    assert.ok(cmd);
    const { ctx, replies } = makeCtx({ guildId: 'g1', userId: 'u1' });
    await cmd.run(ctx);
    const text = embedText(replies[0]);
    for (const item of CATALOG) {
      assert.match(text, new RegExp(item.id));
    }
  });

  it(',buy deducts credits, marks owned, and prevents repurchase', async () => {
    const config = tmpConfig();
    const wallet = tmpWallet(500);
    const registry = new CommandRegistry({ prefix: ',' });
    createShop({ config, wallet, shopStore: tmpShopStore() }).register(registry);

    const buyCmd = registry.get('buy');
    const invCmd = registry.get('inv');
    assert.ok(buyCmd);
    assert.ok(invCmd);

    const { ctx: buyCtx, replies: buyReplies } = makeCtx({
      guildId: 'g1', userId: 'u1', args: ['title_rookie'],
    });
    await buyCmd.run(buyCtx);
    assert.match(embedText(buyReplies[0]), /Purchased/);
    assert.equal(wallet.getBalance('g1', 'u1'), 500 - 50);

    const { ctx: invCtx, replies: invReplies } = makeCtx({ guildId: 'g1', userId: 'u1' });
    await invCmd.run(invCtx);
    assert.match(embedText(invReplies[0]), /Rookie/);

    const { ctx: rebuyCtx, replies: rebuyReplies } = makeCtx({
      guildId: 'g1', userId: 'u1', args: ['title_rookie'],
    });
    await buyCmd.run(rebuyCtx);
    assert.match(embedText(rebuyReplies[0]), /Already owned/);
    assert.equal(wallet.getBalance('g1', 'u1'), 500 - 50, 'balance unchanged on repurchase attempt');
  });

  it(',buy rejects when balance is insufficient', async () => {
    const config = tmpConfig();
    const wallet = tmpWallet(10);
    const registry = new CommandRegistry({ prefix: ',' });
    createShop({ config, wallet, shopStore: tmpShopStore() }).register(registry);

    const buyCmd = registry.get('buy');
    const { ctx, replies } = makeCtx({ guildId: 'g1', userId: 'u1', args: ['title_tycoon'] });
    await buyCmd.run(ctx);
    assert.match(embedText(replies[0]), /Not enough credits/);
    assert.equal(wallet.getBalance('g1', 'u1'), 10);
  });

  it(',buy rejects unknown item ids', async () => {
    const config = tmpConfig();
    const wallet = tmpWallet(500);
    const registry = new CommandRegistry({ prefix: ',' });
    createShop({ config, wallet, shopStore: tmpShopStore() }).register(registry);

    const buyCmd = registry.get('buy');
    const { ctx, replies } = makeCtx({ guildId: 'g1', userId: 'u1', args: ['not_a_real_item'] });
    await buyCmd.run(ctx);
    assert.match(embedText(replies[0]), /Unknown item/);
  });

  it('flare_gold triggers a map wave via tracker when the buyer is on the map', async () => {
    const config = tmpConfig();
    const wallet = tmpWallet(500);
    const calls = [];
    const tracker = {
      isOnMap: () => true,
      setMapAction: (...args) => calls.push(args),
    };
    const registry = new CommandRegistry({ prefix: ',' });
    createShop({ config, wallet, tracker, shopStore: tmpShopStore() }).register(registry);

    const buyCmd = registry.get('buy');
    const { ctx, replies } = makeCtx({ guildId: 'g1', userId: 'u1', args: ['flare_gold'] });
    await buyCmd.run(ctx);
    assert.match(embedText(replies[0]), /Purchased/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'g1');
    assert.equal(calls[0][1], 'u1');
    assert.equal(calls[0][2].pose, 'wave');
  });

  it('inventory is empty by default', async () => {
    const config = tmpConfig();
    const wallet = tmpWallet(500);
    const registry = new CommandRegistry({ prefix: ',' });
    createShop({ config, wallet, shopStore: tmpShopStore() }).register(registry);

    const invCmd = registry.get('inv');
    const { ctx, replies } = makeCtx({ guildId: 'g1', userId: 'fresh-user' });
    await invCmd.run(ctx);
    assert.match(embedText(replies[0]), /Nothing owned yet/);
  });
});
