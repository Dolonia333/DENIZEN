'use strict';

/**
 * /avatar — Discord Spaces character closet (P0–P3).
 * Premade picker, layered looks, randomize, show @user, preview PNG.
 */

const path = require('path');
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  EmbedBuilder,
} = require('discord.js');

const avatarApi = require(path.join(__dirname, '../../../../src/discord-avatar'));

const drafts = new Map(); // userId -> avatar draft

function isMod(member) {
  if (!member?.permissions) return false;
  try {
    return member.permissions.has('ManageGuild') || member.permissions.has('Administrator');
  } catch (_) {
    return false;
  }
}

function unlocksFor(member) {
  return avatarApi.resolveUnlocks({ isMod: isMod(member) });
}

function getDraft(userId, member) {
  if (!drafts.has(userId)) {
    const store = avatarApi.getAvatarStore();
    const saved = store.get(userId);
    drafts.set(userId, avatarApi.normalizeAvatar({
      ...saved,
      unlocks: unlocksFor(member),
    }, userId));
  }
  return drafts.get(userId);
}

function setDraft(userId, avatar) {
  drafts.set(userId, avatarApi.normalizeAvatar(avatar, userId));
  return drafts.get(userId);
}

function summarize(av) {
  if (av.mode === 'premade') {
    return `Premade **${av.premade}**`
      + (av.tint?.clothes ? ` · tint ${av.tint.clothes}` : '');
  }
  const bits = [
    `body **${av.body}**`,
    `hair **${av.hair.set}#${av.hair.index}**`,
    `outfit **${av.outfit.set}#${av.outfit.index}**`,
  ];
  if (av.hat?.set && av.hat.set !== 'none') bits.push(`hat **${av.hat.set}#${av.hat.index}**`);
  if (av.tint?.hair) bits.push(`hair tint ${av.tint.hair}`);
  if (av.tint?.clothes) bits.push(`clothes tint ${av.tint.clothes}`);
  return bits.join(' · ');
}

async function buildPreviewAttachment(userId, av) {
  const buf = await avatarApi.bakePreview(av, 4);
  return new AttachmentBuilder(buf, { name: `avatar-${userId}.png` });
}

function selectMenus(userId, av, unlocks) {
  const cat = avatarApi.publicCatalog(unlocks);
  const uid = String(userId);

  const modeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`avatar:mode:${uid}`)
      .setPlaceholder(`Mode: ${av.mode}`)
      .addOptions(
        { label: 'Premade character', value: 'premade', default: av.mode === 'premade' },
        { label: 'Custom layers (skin/hair/clothes)', value: 'layers', default: av.mode === 'layers' },
      ),
  );

  // Discord max 25 options per select; max 5 rows total (4 menus + 1 button row).
  const premadeOpts = cat.premades.slice(0, 25).map((p) => ({
    label: p.label,
    value: p.id,
    default: av.premade === p.id,
  }));

  const premadeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`avatar:premade:${uid}`)
      .setPlaceholder(`Premade: ${av.premade}`)
      .addOptions(premadeOpts.length ? premadeOpts : [{ label: 'Male 1', value: 'npc_m1' }]),
  );

  const bodyOpts = cat.bodies.map((b) => ({
    label: b.label,
    value: b.id,
    default: av.body === b.id,
  }));
  const bodyRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`avatar:body:${uid}`)
      .setPlaceholder(`Skin: ${av.body}`)
      .addOptions(bodyOpts),
  );

  const hairOpts = [];
  for (const hs of cat.hairSets) {
    if (hs.id === 'none') {
      hairOpts.push({
        label: 'Hair: None',
        value: 'none:0',
        default: av.hair.set === 'none',
      });
      continue;
    }
    for (let i = 0; i < Math.min(8, hs.count); i += 1) {
      if (hairOpts.length >= 25) break;
      hairOpts.push({
        label: `${hs.label} #${i + 1}`,
        value: `${hs.id}:${i}`,
        default: av.hair.set === hs.id && av.hair.index === i,
      });
    }
    if (hairOpts.length >= 25) break;
  }
  const hairRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`avatar:hair:${uid}`)
      .setPlaceholder(`Hair: ${av.hair.set} #${av.hair.index}`)
      .addOptions(hairOpts),
  );

  return [modeRow, premadeRow, bodyRow, hairRow];
}

function buttonRow(userId) {
  const uid = String(userId);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`avatar:save:${uid}`).setLabel('Save').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`avatar:random:${uid}`).setLabel('Randomize').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`avatar:outfit:${uid}`).setLabel('Next outfit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`avatar:tint:${uid}`).setLabel('Cycle tint').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`avatar:reset:${uid}`).setLabel('Reset').setStyle(ButtonStyle.Danger),
  );
}

async function closetPayload(userId, member, av) {
  const unlocks = unlocksFor(member);
  const events = avatarApi.getActiveEvents();
  const eventLine = events.length
    ? `Events: ${events.map((e) => e.label).join(', ')}`
    : 'No seasonal events right now';
  const file = await buildPreviewAttachment(userId, av);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Discord Spaces — Avatar closet')
    .setDescription([
      summarize(av),
      '',
      eventLine,
      '_Changes apply on the pixel map after you **Save** (next presence tick)._',
    ].join('\n'))
    .setImage(`attachment://avatar-${userId}.png`)
    .setFooter({ text: `rev ${av.rev || 1} · unlocks ${unlocks.length}` });

  const components = [...selectMenus(userId, av, unlocks), buttonRow(userId)];
  return {
    embeds: [embed],
    components,
    files: [file],
    ephemeral: true,
  };
}

function createAvatarModule() {
  const store = avatarApi.getAvatarStore();

  function register(registry) {
    registry.register({
      name: 'avatar',
      description: 'Customize your Discord Spaces look (clothes, skin, hair)',
      module: 'avatar',
      aliases: ['closet', 'look', 'clothes'],
      options: [
        {
          type: 1,
          name: 'edit',
          description: 'Open the avatar closet',
        },
        {
          type: 1,
          name: 'random',
          description: 'Randomize and save a new look',
        },
        {
          type: 1,
          name: 'show',
          description: 'Show your look or another member',
          options: [
            {
              type: 6,
              name: 'user',
              description: 'Whose avatar to show',
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: 'reset',
          description: 'Reset to default premade look',
        },
        {
          type: 1,
          name: 'save',
          description: 'Save current draft without opening menus',
        },
      ],
      async run(ctx) {
        const userId = String(ctx.user.id);
        const sub = ctx.interaction?.options?.getSubcommand?.(false)
          || ctx.args?.[0]
          || 'edit';

        if (sub === 'show' || sub === 'preview') {
          const target = ctx.getUser?.('user')
            || ctx.message?.mentions?.users?.first?.()
            || ctx.user;
          const tid = String(target.id);
          const av = store.get(tid);
          let file;
          try {
            file = await buildPreviewAttachment(tid, av);
          } catch (err) {
            return ctx.reply(`Could not render avatar: ${err.message || err}`);
          }
          const embed = new EmbedBuilder()
            .setColor(0x3dd68c)
            .setTitle(`${target.username || tid}'s avatar`)
            .setDescription(summarize(av))
            .setImage(`attachment://avatar-${tid}.png`);
          return ctx.reply({
            embeds: [embed],
            files: [file],
            ephemeral: true,
          });
        }

        if (sub === 'random') {
          const av = avatarApi.randomAvatar(userId, unlocksFor(ctx.member));
          setDraft(userId, av);
          const saved = await avatarApi.ensureBaked(store, userId, av);
          drafts.set(userId, saved);
          const payload = await closetPayload(userId, ctx.member, saved);
          payload.content = '🎲 Randomized and **saved** to the map.';
          return ctx.reply(payload);
        }

        if (sub === 'reset') {
          const av = avatarApi.defaultAvatar(userId);
          const saved = await avatarApi.ensureBaked(store, userId, av);
          drafts.set(userId, saved);
          return ctx.reply({
            content: `Reset to default **${saved.premade}**.`,
            ephemeral: true,
          });
        }

        if (sub === 'save') {
          const draft = getDraft(userId, ctx.member);
          const saved = await avatarApi.ensureBaked(store, userId, draft);
          drafts.set(userId, saved);
          return ctx.reply({ content: `Saved · ${summarize(saved)}`, ephemeral: true });
        }

        // edit (default)
        const draft = getDraft(userId, ctx.member);
        const payload = await closetPayload(userId, ctx.member, draft);
        return ctx.reply(payload);
      },
    });

    // Quick text: ,clothes ,hair ,skin
    registry.register({
      name: 'skin',
      description: 'Set avatar skin tone',
      module: 'avatar',
      slash: false,
      async run(ctx) {
        const body = String(ctx.args?.[0] || '').toLowerCase();
        const allowed = avatarApi.BODIES.map((b) => b.id);
        if (!allowed.includes(body)) {
          return ctx.reply(`Usage: \`,skin <${allowed.join('|')}>\``);
        }
        const unlocks = unlocksFor(ctx.member);
        const meta = avatarApi.BODIES.find((b) => b.id === body);
        if (meta?.unlock && !unlocks.includes(meta.unlock)) {
          return ctx.reply(`Skin **${body}** is locked (need ${meta.unlock}).`);
        }
        const draft = getDraft(ctx.user.id, ctx.member);
        draft.mode = 'layers';
        draft.body = body;
        const saved = await avatarApi.ensureBaked(store, ctx.user.id, draft);
        drafts.set(ctx.user.id, saved);
        return ctx.reply(`Skin set to **${body}** and saved.`);
      },
    });

    registry.register({
      name: 'hair',
      description: 'Set hair: ,hair short 3',
      module: 'avatar',
      slash: false,
      async run(ctx) {
        const set = String(ctx.args?.[0] || 'short').toLowerCase();
        const index = Number(ctx.args?.[1] ?? 0) || 0;
        const draft = getDraft(ctx.user.id, ctx.member);
        draft.mode = 'layers';
        draft.hair = { set: ['short', 'long', 'unique', 'none'].includes(set) ? set : 'short', index };
        const saved = await avatarApi.ensureBaked(store, ctx.user.id, draft);
        drafts.set(ctx.user.id, saved);
        return ctx.reply(`Hair **${saved.hair.set} #${saved.hair.index}** saved.`);
      },
    });

    registry.register({
      name: 'clothes',
      description: 'Set outfit index: ,clothes 7',
      module: 'avatar',
      slash: false,
      async run(ctx) {
        const index = Number(ctx.args?.[0] ?? 0) || 0;
        const setName = String(ctx.args?.[1] || 'outfits').toLowerCase();
        const draft = getDraft(ctx.user.id, ctx.member);
        draft.mode = 'layers';
        draft.outfit = {
          set: avatarApi.OUTFIT_SETS.some((o) => o.id === setName) ? setName : 'outfits',
          index,
        };
        const saved = await avatarApi.ensureBaked(store, ctx.user.id, draft);
        drafts.set(ctx.user.id, saved);
        return ctx.reply(`Outfit **${saved.outfit.set} #${saved.outfit.index}** saved.`);
      },
    });
  }

  async function onInteraction(interaction) {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return false;
    const id = interaction.customId || '';
    if (!id.startsWith('avatar:')) return false;

    const parts = id.split(':');
    const action = parts[1];
    const ownerId = parts[2];
    if (String(interaction.user.id) !== String(ownerId)) {
      await interaction.reply({ content: 'That closet belongs to someone else.', ephemeral: true }).catch(() => {});
      return true;
    }

    const userId = String(interaction.user.id);
    let draft = getDraft(userId, interaction.member);

    try {
      if (interaction.isStringSelectMenu()) {
        const val = interaction.values[0];
        if (action === 'mode') {
          draft.mode = val === 'layers' ? 'layers' : 'premade';
        } else if (action === 'premade' || action === 'premade2') {
          draft.premade = val;
          draft.mode = 'premade';
        } else if (action === 'body') {
          draft.body = val;
          draft.mode = 'layers';
        } else if (action === 'hair') {
          const [set, idx] = val.split(':');
          draft.hair = { set, index: Number(idx) || 0 };
          draft.mode = 'layers';
        }
        draft = setDraft(userId, draft);
        // Live preview without save
        const payload = await closetPayload(userId, interaction.member, draft);
        await interaction.update(payload);
        return true;
      }

      if (interaction.isButton()) {
        if (action === 'random') {
          draft = setDraft(userId, avatarApi.randomAvatar(userId, unlocksFor(interaction.member)));
          const payload = await closetPayload(userId, interaction.member, draft);
          payload.content = '🎲 Randomized (not saved yet — hit **Save**).';
          await interaction.update(payload);
          return true;
        }
        if (action === 'outfit') {
          draft.mode = 'layers';
          draft.outfit = {
            set: draft.outfit?.set || 'outfits',
            index: ((draft.outfit?.index || 0) + 1) % 50,
          };
          draft = setDraft(userId, draft);
          const payload = await closetPayload(userId, interaction.member, draft);
          await interaction.update(payload);
          return true;
        }
        if (action === 'tint') {
          const unlocks = unlocksFor(interaction.member);
          const tints = avatarApi.filterByUnlock(avatarApi.TINTS, unlocks);
          const cur = draft.tint?.clothes || draft.tint?.hair;
          const idx = Math.max(0, tints.findIndex((t) => t.id === cur));
          const next = tints[(idx + 1) % tints.length];
          draft.tint = { hair: next.id, clothes: next.id };
          draft = setDraft(userId, draft);
          const payload = await closetPayload(userId, interaction.member, draft);
          await interaction.update(payload);
          return true;
        }
        if (action === 'reset') {
          draft = setDraft(userId, avatarApi.defaultAvatar(userId));
          const payload = await closetPayload(userId, interaction.member, draft);
          await interaction.update(payload);
          return true;
        }
        if (action === 'save') {
          await interaction.deferUpdate();
          const saved = await avatarApi.ensureBaked(store, userId, draft);
          drafts.set(userId, saved);
          const payload = await closetPayload(userId, interaction.member, saved);
          payload.content = `✅ **Saved** to the map · ${summarize(saved)}`;
          await interaction.editReply(payload);
          return true;
        }
      }
    } catch (err) {
      console.error('[avatar]', err);
      const msg = { content: `Avatar error: ${err.message || err}`, ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
      return true;
    }
    return true;
  }

  return { register, onInteraction, store };
}

module.exports = { createAvatarModule };
