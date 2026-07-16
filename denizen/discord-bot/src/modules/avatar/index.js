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

function unlocksFor(member) {
  return avatarApi.detectRoles(member).unlocks;
}

function planFor(member, guildId) {
  try {
    // Prefer guild Spaces plan from config store if injected later
    const envPlan = process.env.DENIZEN_SPACES_PLAN;
    return avatarApi.resolvePlan(envPlan || 'free');
  } catch (_) {
    return 'free';
  }
}

function featuresFor(member) {
  const roles = avatarApi.detectRoles(member);
  return avatarApi.planFeatures(planFor(member), { isBooster: roles.isBooster });
}

/**
 * Load saved look, enforce free/paid plan, apply booster headset if eligible.
 */
function getDraft(userId, member) {
  if (!drafts.has(userId)) {
    const store = avatarApi.getAvatarStore();
    const saved = store.get(userId);
    const roles = avatarApi.detectRoles(member);
    const plan = planFor(member);
    let { avatar } = avatarApi.enforceAvatarPlan(saved, userId, {
      plan,
      isBooster: roles.isBooster,
    });
    const role = avatarApi.applyRoleCosmetics(avatar, member);
    avatar = role.avatar;
    avatar = avatarApi.enforceAvatarPlan(avatar, userId, {
      plan,
      isBooster: roles.isBooster,
    }).avatar;
    if (roles.isBooster) {
      avatar = avatarApi.applyBoosterGoldenHeadset(avatar, { isBooster: true }).avatar;
    }
    avatar._roleSummary = role.summary;
    avatar._plan = plan;
    drafts.set(userId, avatar);
  }
  return drafts.get(userId);
}

function setDraft(userId, avatar, member = null) {
  const roles = member ? avatarApi.detectRoles(member) : { isBooster: false };
  const plan = planFor(member);
  let av = avatarApi.normalizeAvatar(avatar, userId);
  av = avatarApi.enforceAvatarPlan(av, userId, {
    plan,
    isBooster: roles.isBooster,
  }).avatar;
  if (member) {
    const { avatar: next, summary } = avatarApi.applyRoleCosmetics(av, member);
    av = next;
    av._roleSummary = summary;
    av = avatarApi.enforceAvatarPlan(av, userId, {
      plan,
      isBooster: roles.isBooster,
    }).avatar;
    if (roles.isBooster) {
      av = avatarApi.applyBoosterGoldenHeadset(av, { isBooster: true }).avatar;
    }
  }
  av._plan = plan;
  drafts.set(userId, av);
  return av;
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
  if (av.hat?.set === 'headsets') {
    bits.push('🎧 **golden headset** (Booster)');
  } else if (av.hat?.set && av.hat.set !== 'none') {
    bits.push(`hat **${av.hat.set}#${av.hat.index}**`);
  }
  if (av.tint?.hair) bits.push(`hair tint ${av.tint.hair}`);
  if (av.tint?.clothes) bits.push(`clothes tint ${av.tint.clothes}`);
  if (av.tint?.hat) bits.push(`hat tint ${av.tint.hat}`);
  return bits.join(' · ');
}

async function buildPreviewAttachment(userId, av) {
  const buf = await avatarApi.bakePreview(av, 4);
  return new AttachmentBuilder(buf, { name: `avatar-${userId}.png` });
}

function selectMenus(userId, av, unlocks, features) {
  const cat = avatarApi.publicCatalogForPlan(features.plan, unlocks, {
    isBooster: features.headsets && !features.paid,
  });
  const uid = String(userId);
  const rows = [];

  // Free: premade only. Paid: premade or full layers.
  if (features.paid) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`avatar:mode:${uid}`)
        .setPlaceholder(`Mode: ${av.mode}`)
        .addOptions(
          { label: 'Premade character', value: 'premade', default: av.mode === 'premade' },
          { label: 'Custom (hair, clothes, hats…)', value: 'layers', default: av.mode === 'layers' },
        ),
    ));
  }

  const premadeOpts = (cat.premades || []).slice(0, 25).map((p) => ({
    label: p.label,
    value: p.id,
    default: av.premade === p.id,
  }));
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`avatar:premade:${uid}`)
      .setPlaceholder(`Premade: ${av.premade}`)
      .addOptions(premadeOpts.length ? premadeOpts : [{ label: 'Male 1', value: 'npc_m1' }]),
  ));

  // Free + paid: skin tone (free skins only on free plan)
  const bodyOpts = (cat.bodies || []).map((b) => ({
    label: features.paid ? b.label : `${b.label} (skin)`,
    value: b.id,
    default: av.body === b.id,
  }));
  if (bodyOpts.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`avatar:body:${uid}`)
        .setPlaceholder(`Skin tone: ${av.body}`)
        .addOptions(bodyOpts),
    ));
  }

  // Paid only: hair
  if (features.hairStyle && (cat.hairSets || []).length) {
    const hairOpts = [];
    for (const hs of cat.hairSets) {
      if (hs.id === 'none') {
        hairOpts.push({ label: 'Hair: None', value: 'none:0', default: av.hair?.set === 'none' });
        continue;
      }
      for (let i = 0; i < Math.min(8, hs.count || 0); i += 1) {
        if (hairOpts.length >= 25) break;
        hairOpts.push({
          label: `${hs.label} #${i + 1}`,
          value: `${hs.id}:${i}`,
          default: av.hair?.set === hs.id && av.hair?.index === i,
        });
      }
      if (hairOpts.length >= 25) break;
    }
    if (hairOpts.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`avatar:hair:${uid}`)
          .setPlaceholder(`Hair: ${av.hair?.set || '—'} (paid)`)
          .addOptions(hairOpts),
      ));
    }
  }

  // Max 4 select rows + 1 button row
  return rows.slice(0, 4);
}

function buttonRow(userId, features) {
  const uid = String(userId);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`avatar:save:${uid}`).setLabel('Save').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`avatar:random:${uid}`).setLabel('Randomize').setStyle(ButtonStyle.Primary),
  );
  if (features.clothes) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`avatar:outfit:${uid}`).setLabel('Next outfit').setStyle(ButtonStyle.Secondary),
    );
  }
  if (features.hairColor || features.premiumTints) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`avatar:tint:${uid}`).setLabel('Hair/clothes color').setStyle(ButtonStyle.Secondary),
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(`avatar:reset:${uid}`).setLabel('Reset').setStyle(ButtonStyle.Danger),
  );
  return row;
}

async function closetPayload(userId, member, av) {
  const roles = avatarApi.detectRoles(member);
  const unlocks = roles.unlocks;
  const features = featuresFor(member);
  const events = avatarApi.getActiveEvents();
  const eventLine = events.length
    ? `Events: ${events.map((e) => e.label).join(', ')}`
    : 'No seasonal events right now';
  const planLine = features.paid
    ? `**${features.plan} plan** — hair, clothes, masks, hats unlocked.`
    : [
      '**Free plan:** premade characters + skin tones only.',
      '**Paid:** hair, hair color, clothes, masks, hats & headsets.',
    ].join('\n');
  const roleLine = roles.isBooster
    ? '**Server booster** — golden headset included on free.'
    : 'Boost this server for a **golden headset** (free perk).';
  const file = await buildPreviewAttachment(userId, av);
  const embed = new EmbedBuilder()
    .setColor(roles.isBooster ? 0xf0c14a : (features.paid ? 0x3dd68c : 0x5865f2))
    .setTitle('Discord Spaces — Avatar closet')
    .setDescription([
      summarize(av),
      '',
      planLine,
      roleLine,
      eventLine,
      '_Save to apply on the pixel map._',
    ].join('\n'))
    .setImage(`attachment://avatar-${userId}.png`)
    .setFooter({
      text: `rev ${av.rev || 1} · ${features.plan} · ${roles.labels.join('/') || 'member'}`,
    });

  const components = [
    ...selectMenus(userId, av, unlocks, features),
    buttonRow(userId, features),
  ];
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
      description: 'Pixel map look — closet, skin, hair, clothes (boosters get golden headset)',
      module: 'avatar',
      aliases: ['closet', 'look'],
      options: [
        {
          type: 1,
          name: 'edit',
          description: 'Open the closet UI (preview + Save to map)',
        },
        {
          type: 1,
          name: 'random',
          description: 'Randomize look and save to the map',
        },
        {
          type: 1,
          name: 'show',
          description: 'Preview your look or @someone’s',
          options: [
            {
              type: 6,
              name: 'user',
              description: 'Member to preview',
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: 'reset',
          description: 'Back to default premade character',
        },
        {
          type: 1,
          name: 'save',
          description: 'Save draft to the live map',
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
          const feat = featuresFor(ctx.member);
          let av = avatarApi.randomAvatar(userId, unlocksFor(ctx.member));
          if (!feat.paid) {
            av.mode = 'premade';
          }
          av = setDraft(userId, av, ctx.member);
          const roles = avatarApi.detectRoles(ctx.member);
          const saved = await avatarApi.ensureBaked(store, userId, av, {
            plan: feat.plan,
            isBooster: roles.isBooster,
            member: ctx.member,
          });
          drafts.set(userId, saved);
          const payload = await closetPayload(userId, ctx.member, saved);
          payload.content = feat.paid
            ? 'Randomized and **saved** to the map.'
            : 'Randomized **premade** and saved. Upgrade for hair, clothes, hats.';
          return ctx.reply(payload);
        }

        if (sub === 'reset') {
          let av = avatarApi.defaultAvatar(userId);
          av = setDraft(userId, av, ctx.member);
          const feat = featuresFor(ctx.member);
          const roles = avatarApi.detectRoles(ctx.member);
          const saved = await avatarApi.ensureBaked(store, userId, av, {
            plan: feat.plan,
            isBooster: roles.isBooster,
            member: ctx.member,
          });
          drafts.set(userId, saved);
          return ctx.reply({
            content: `Reset · ${summarize(saved)}`,
            ephemeral: true,
          });
        }

        if (sub === 'save') {
          const draft = getDraft(userId, ctx.member);
          const feat = featuresFor(ctx.member);
          const roles = avatarApi.detectRoles(ctx.member);
          const saved = await avatarApi.ensureBaked(store, userId, draft, {
            plan: feat.plan,
            isBooster: roles.isBooster,
            member: ctx.member,
          });
          drafts.set(userId, saved);
          return ctx.reply({ content: `Saved · ${summarize(saved)}`, ephemeral: true });
        }

        // edit (default) — refresh role cosmetics each open
        drafts.delete(userId);
        const draft = getDraft(userId, ctx.member);
        const payload = await closetPayload(userId, ctx.member, draft);
        return ctx.reply(payload);
      },
    });

    // Quick text: ,clothes ,hair ,skin
    registry.register({
      name: 'skin',
      description: 'Set free skin tone (light|white|lightdark|dark)',
      module: 'avatar',
      slash: false,
      async run(ctx) {
        const body = String(ctx.args?.[0] || '').toLowerCase();
        const freeSkins = avatarApi.FREE_SKIN_TONES || ['light', 'white', 'lightdark', 'dark'];
        const feat = featuresFor(ctx.member);
        const allowed = feat.paid
          ? avatarApi.BODIES.map((b) => b.id)
          : freeSkins;
        if (!allowed.includes(body)) {
          return ctx.reply(
            feat.paid
              ? `Usage: \`,skin <${allowed.join('|')}>\``
              : `**Free skins:** \`,skin <${freeSkins.join('|')}>\`\nHair/clothes need Community plan.`,
          );
        }
        const unlocks = unlocksFor(ctx.member);
        const meta = avatarApi.BODIES.find((b) => b.id === body);
        if (meta?.unlock && !unlocks.includes(meta.unlock)) {
          return ctx.reply(`Skin **${body}** is locked (need ${meta.unlock}).`);
        }
        const draft = getDraft(ctx.user.id, ctx.member);
        // Free: keep premade look; store preferred skin for paid upgrade
        draft.body = body;
        if (feat.paid) draft.mode = 'layers';
        const roles = avatarApi.detectRoles(ctx.member);
        const saved = await avatarApi.ensureBaked(store, ctx.user.id, draft, {
          plan: feat.plan,
          isBooster: roles.isBooster,
          member: ctx.member,
        });
        drafts.set(ctx.user.id, saved);
        return ctx.reply(
          feat.paid
            ? `Skin set to **${body}** and saved.`
            : `Skin preference **${body}** saved. Free looks use **premade** NPCs — upgrade for custom layers with this skin.`,
        );
      },
    });

    registry.register({
      name: 'hair',
      description: 'Set hair (Community plan): ,hair short 3',
      module: 'avatar',
      slash: false,
      async run(ctx) {
        const feat = featuresFor(ctx.member);
        if (!feat.hairStyle) {
          return ctx.reply(avatarApi.upgradeMessage(feat));
        }
        const set = String(ctx.args?.[0] || 'short').toLowerCase();
        const index = Number(ctx.args?.[1] ?? 0) || 0;
        const draft = getDraft(ctx.user.id, ctx.member);
        draft.mode = 'layers';
        draft.hair = { set: ['short', 'long', 'unique', 'none'].includes(set) ? set : 'short', index };
        const roles = avatarApi.detectRoles(ctx.member);
        const saved = await avatarApi.ensureBaked(store, ctx.user.id, draft, {
          plan: feat.plan,
          isBooster: roles.isBooster,
          member: ctx.member,
        });
        drafts.set(ctx.user.id, saved);
        return ctx.reply(`Hair **${saved.hair.set} #${saved.hair.index}** saved.`);
      },
    });

    registry.register({
      name: 'clothes',
      description: 'Set outfit (Community plan): ,clothes 7',
      module: 'avatar',
      slash: false,
      async run(ctx) {
        const feat = featuresFor(ctx.member);
        if (!feat.clothes) {
          return ctx.reply(avatarApi.upgradeMessage(feat));
        }
        const index = Number(ctx.args?.[0] ?? 0) || 0;
        const setName = String(ctx.args?.[1] || 'outfits').toLowerCase();
        const draft = getDraft(ctx.user.id, ctx.member);
        draft.mode = 'layers';
        draft.outfit = {
          set: avatarApi.OUTFIT_SETS.some((o) => o.id === setName) ? setName : 'outfits',
          index,
        };
        const roles = avatarApi.detectRoles(ctx.member);
        const saved = await avatarApi.ensureBaked(store, ctx.user.id, draft, {
          plan: feat.plan,
          isBooster: roles.isBooster,
          member: ctx.member,
        });
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
        draft = setDraft(userId, draft, interaction.member);
        // Live preview without save
        const payload = await closetPayload(userId, interaction.member, draft);
        await interaction.update(payload);
        return true;
      }

      if (interaction.isButton()) {
        if (action === 'random') {
          const feat = featuresFor(interaction.member);
          let av = avatarApi.randomAvatar(userId, unlocksFor(interaction.member));
          if (!feat.paid) av.mode = 'premade';
          draft = setDraft(userId, av, interaction.member);
          const payload = await closetPayload(userId, interaction.member, draft);
          payload.content = feat.paid
            ? 'Randomized (not saved yet — hit **Save**).'
            : 'Randomized **premade** (free). Hit **Save**. Upgrade for hair/clothes.';
          await interaction.update(payload);
          return true;
        }
        if (action === 'outfit') {
          const feat = featuresFor(interaction.member);
          if (!feat.clothes) {
            await interaction.reply({ content: avatarApi.upgradeMessage(feat), ephemeral: true }).catch(() => {});
            return true;
          }
          draft.mode = 'layers';
          draft.outfit = {
            set: draft.outfit?.set || 'outfits',
            index: ((draft.outfit?.index || 0) + 1) % 50,
          };
          draft = setDraft(userId, draft, interaction.member);
          const payload = await closetPayload(userId, interaction.member, draft);
          await interaction.update(payload);
          return true;
        }
        if (action === 'tint') {
          const feat = featuresFor(interaction.member);
          if (!feat.hairColor && !feat.premiumTints) {
            await interaction.reply({ content: avatarApi.upgradeMessage(feat), ephemeral: true }).catch(() => {});
            return true;
          }
          const unlocks = unlocksFor(interaction.member);
          const tints = avatarApi.filterByUnlock(avatarApi.TINTS, unlocks);
          const cur = draft.tint?.clothes || draft.tint?.hair;
          const idx = Math.max(0, tints.findIndex((t) => t.id === cur));
          const next = tints[(idx + 1) % tints.length];
          draft.tint = { hair: next.id, clothes: next.id, source: 'manual' };
          draft = setDraft(userId, draft, interaction.member);
          const payload = await closetPayload(userId, interaction.member, draft);
          await interaction.update(payload);
          return true;
        }
        if (action === 'reset') {
          draft = setDraft(userId, avatarApi.defaultAvatar(userId), interaction.member);
          const payload = await closetPayload(userId, interaction.member, draft);
          await interaction.update(payload);
          return true;
        }
        if (action === 'save') {
          await interaction.deferUpdate();
          draft = setDraft(userId, draft, interaction.member);
          const feat = featuresFor(interaction.member);
          const roles = avatarApi.detectRoles(interaction.member);
          const saved = await avatarApi.ensureBaked(store, userId, draft, {
            plan: feat.plan,
            isBooster: roles.isBooster,
            member: interaction.member,
          });
          drafts.set(userId, saved);
          const payload = await closetPayload(userId, interaction.member, saved);
          payload.content = `**Saved** · ${summarize(saved)}`
            + (feat.free ? '\n_Free: premade + skin. Upgrade for hair, clothes, hats._' : '');
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
