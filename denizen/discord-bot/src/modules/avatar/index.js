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
const { baseEmbed, BRAND, brandFooter } = require('../../core/ui-kit');

const avatarApi = require(path.join(__dirname, '../../../../src/discord-avatar'));

function createAvatarModule(deps = {}) {
  const { config } = deps;
  let guildPlans = null;
  try {
    guildPlans = require(path.join(__dirname, '../../../../src/denizen-guild-plans.js'));
  } catch (_) { guildPlans = null; }
  let guildPets = null;
  try {
    guildPets = require(path.join(__dirname, '../../../../src/denizen-guild-pets.js'));
  } catch (_) { guildPets = null; }
  let guildBilling = null;
  try {
    guildBilling = require(path.join(__dirname, '../../../../src/denizen-guild-billing.js'));
  } catch (_) { guildBilling = null; }

  const drafts = new Map(); // userId -> avatar draft

  function unlocksFor(member) {
    return avatarApi.detectRoles(member).unlocks;
  }

  function planFor(member, guildId) {
    try {
      const gid = guildId || member?.guild?.id;
      if (gid && config) {
        const sp = config.get(gid)?.spaces?.plan;
        if (sp) return avatarApi.resolvePlan(sp);
      }
      if (gid && guildPlans?.peekGuildPlan) {
        const peeked = guildPlans.peekGuildPlan(gid);
        if (peeked?.plan && peeked.plan !== 'free') return avatarApi.resolvePlan(peeked.plan);
        if (peeked?.active) return avatarApi.resolvePlan(peeked.plan || 'pro');
      }
      const envPlan = process.env.DENIZEN_SPACES_PLAN;
      return avatarApi.resolvePlan(envPlan || 'free');
    } catch (_) {
      return 'free';
    }
  }

  function featuresFor(member, guildId) {
    const roles = avatarApi.detectRoles(member);
    return avatarApi.planFeatures(planFor(member, guildId), { isBooster: roles.isBooster });
  }

  function upgradeUrl() {
    return String(process.env.DISCORD_UPGRADE_URL || '').trim();
  }

  function petLockedReply() {
    const u = upgradeUrl();
    return [
      '🐾 **You need a pet entitlement in this server.**',
      '• Buy: `,pet buy` (or gift someone with `,pet buy @user`)',
      '• Ask staff: Pro servers get **3 free grants** — `,pet grant @member`',
      u ? `Server Pro upgrade: ${u}` : null,
    ].filter(Boolean).join('\n');
  }

  function canManagePetGrants(member) {
    try {
      return !!(member?.permissions?.has?.('ManageGuild') || member?.permissions?.has?.('Administrator'));
    } catch (_) {
      return false;
    }
  }

  async function userHasPet(guildId, userId) {
    if (!guildPets?.hasPetEntitlement) return false;
    return guildPets.hasPetEntitlement(guildId, userId);
  }

  async function savePet(userId, member, pet) {
    const store = avatarApi.getAvatarStore();
    const plan = planFor(member);
    const roles = avatarApi.detectRoles(member);
    let av = store.get(userId);
    av = { ...av, pet };
    const gated = avatarApi.enforceAvatarPlan(av, userId, {
      plan,
      isBooster: roles.isBooster,
    }).avatar;
    return avatarApi.ensureBaked(store, userId, gated, {
      plan,
      isBooster: roles.isBooster,
      member,
    });
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
    if (av.pet?.enabled && av.pet?.kind) bits.push(`🐾 **${av.pet.kind}**`);
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
  // Discord hard limit: 5 buttons per row. Always: Save · Randomize · Reset.
  const buttons = [
    new ButtonBuilder().setCustomId(`avatar:save:${uid}`).setLabel('Save').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`avatar:random:${uid}`).setLabel('Randomize').setStyle(ButtonStyle.Primary),
  ];
  // Prefer outfit over tint when both would overflow (max 5 with Reset).
  if (features.clothes && buttons.length < 4) {
    buttons.push(
      new ButtonBuilder().setCustomId(`avatar:outfit:${uid}`).setLabel('Next outfit').setStyle(ButtonStyle.Secondary),
    );
  }
  if ((features.hairColor || features.premiumTints) && buttons.length < 4) {
    buttons.push(
      new ButtonBuilder().setCustomId(`avatar:tint:${uid}`).setLabel('Colors').setStyle(ButtonStyle.Secondary),
    );
  }
  buttons.push(
    new ButtonBuilder().setCustomId(`avatar:reset:${uid}`).setLabel('Reset').setStyle(ButtonStyle.Danger),
  );
  return new ActionRowBuilder().addComponents(...buttons.slice(0, 5));
}

async function closetPayload(userId, member, av) {
  const roles = avatarApi.detectRoles(member);
  const unlocks = roles.unlocks;
  const features = featuresFor(member);
  const events = avatarApi.getActiveEvents();
  const planValue = features.paid
    ? `**${features.plan}** — hair, clothes, hats unlocked`
    : '**Free** — premades + skin tones · Paid unlocks closet layers';
  const boostValue = roles.isBooster
    ? 'Golden headset included'
    : 'Boost this server for a golden headset';
  const eventsValue = events.length
    ? events.map((e) => e.label).join(', ')
    : 'None';

  const color = roles.isBooster ? BRAND.warn : (features.paid ? BRAND.success : BRAND.primary);
  const file = await buildPreviewAttachment(userId, av);
  const embed = baseEmbed({
    color,
    title: 'Avatar closet',
    description: [
      summarize(av),
      '',
      '_Save to apply on the pixel map._',
    ].join('\n'),
    image: `attachment://avatar-${userId}.png`,
    fields: [
      { name: 'Plan', value: planValue, inline: true },
      { name: 'Boost', value: boostValue, inline: true },
      { name: 'Events', value: eventsValue, inline: true },
    ],
    footer: brandFooter(`rev ${av.rev || 1} · ${features.plan} · ${roles.labels.join('/') || 'member'}`),
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

  const store = avatarApi.getAvatarStore();

  function register(registry) {
    registry.register({
      name: 'pet',
      description: 'Companion pet for this server — buy, gift, equip, or staff grant',
      aliases: ['companion'],
      module: 'avatar',
      options: [
        {
          type: 3,
          name: 'action',
          description: 'cat | dog | off | status | buy | gift | grant | revoke',
          required: false,
        },
        {
          type: 6,
          name: 'user',
          description: 'Member for gift / grant / revoke / buy-for',
          required: false,
        },
      ],
      async run(ctx) {
        const guildId = ctx.guild?.id;
        if (!guildId) {
          return ctx.reply({ content: 'Pets are per-server — use this in a guild.', ephemeral: true });
        }

        const action = String(
          ctx.getString?.('action') || ctx.args?.[0] || 'status',
        ).toLowerCase();
        const mention = ctx.getUser?.('user')
          || ctx.message?.mentions?.users?.first?.()
          || null;

        // --- buy ---
        if (action === 'buy') {
          if (!guildBilling?.createPetCheckout) {
            return ctx.reply({ content: 'Pet checkout is not configured yet.', ephemeral: true });
          }
          const beneficiary = mention?.id || ctx.user.id;
          const result = await guildBilling.createPetCheckout({
            guildId,
            discordUserId: ctx.user.id,
            giftToUserId: beneficiary !== ctx.user.id ? beneficiary : null,
          });
          if (!result.ok || !result.url) {
            const hint = result.error === 'pet_price_not_configured'
              ? 'Ask the host to set `STRIPE_PRICE_PET`.'
              : `Could not start checkout (${result.error || 'error'}).`;
            return ctx.reply({ content: hint, ephemeral: true });
          }
          const forWho = beneficiary === ctx.user.id ? 'yourself' : `<@${beneficiary}>`;
          return ctx.reply({
            content: `Checkout for a pet in **this server** (for ${forWho}):\n${result.url}`,
            ephemeral: true,
          });
        }

        // --- gift (transfer entitlement) ---
        if (action === 'gift') {
          if (!mention) {
            return ctx.reply({ content: 'Usage: `,pet gift @member`', ephemeral: true });
          }
          if (!guildPets?.giftPet) {
            return ctx.reply({ content: 'Pet entitlements unavailable.', ephemeral: true });
          }
          const result = await guildPets.giftPet({
            guildId,
            fromUserId: ctx.user.id,
            toUserId: mention.id,
          });
          if (!result.ok) {
            const msg = {
              no_entitlement: 'You do not have a pet entitlement to gift in this server.',
              target_has_pet: 'They already have a pet here.',
              self_gift: 'You already own it.',
            }[result.error] || `Gift failed (${result.error}).`;
            return ctx.reply({ content: msg, ephemeral: true });
          }
          await savePet(ctx.user.id, ctx.member, { kind: null, enabled: false });
          drafts.delete(ctx.user.id);
          return ctx.reply(`Gifted your pet entitlement to <@${mention.id}> in this server.`);
        }

        // --- grant (Pro pool) ---
        if (action === 'grant') {
          if (!canManagePetGrants(ctx.member)) {
            return ctx.reply({ content: 'Need **Manage Server** to grant Pro pets.', ephemeral: true });
          }
          if (!mention) {
            const rem = guildPets?.getGrantRemaining
              ? await guildPets.getGrantRemaining(guildId)
              : '?';
            return ctx.reply({
              content: `Usage: \`,pet grant @member\`\nFree Pro grants left: **${rem}/3**`,
              ephemeral: true,
            });
          }
          const result = await guildPets.assignProGrant({
            guildId,
            granterId: ctx.user.id,
            toUserId: mention.id,
          });
          if (!result.ok) {
            const msg = {
              guild_not_pro: 'This server needs an active **Pro** plan for free pet grants.',
              target_has_pet: 'They already have a pet here.',
              no_grants_left: 'No Pro pet grants left (3/3 used). Revoke one with `,pet revoke @user`.',
            }[result.error] || `Grant failed (${result.error}).`;
            return ctx.reply({ content: msg, ephemeral: true });
          }
          return ctx.reply(
            `Granted a Pro pet to <@${mention.id}>. They can \`,pet cat\` or \`,pet dog\`. Grants left: **${result.remaining}/3**.`,
          );
        }

        // --- revoke ---
        if (action === 'revoke') {
          if (!canManagePetGrants(ctx.member)) {
            return ctx.reply({ content: 'Need **Manage Server** to revoke Pro grants.', ephemeral: true });
          }
          if (!mention) {
            return ctx.reply({ content: 'Usage: `,pet revoke @member`', ephemeral: true });
          }
          const result = await guildPets.revokeProGrant({
            guildId,
            userId: mention.id,
          });
          if (!result.ok) {
            const msg = {
              no_entitlement: 'They have no pet entitlement.',
              not_pro_grant: 'That pet was purchased/gifted — only Pro grants can be revoked.',
            }[result.error] || `Revoke failed (${result.error}).`;
            return ctx.reply({ content: msg, ephemeral: true });
          }
          await savePet(mention.id, mention, { kind: null, enabled: false }).catch(() => {});
          return ctx.reply(`Revoked Pro pet grant from <@${mention.id}>. Grants left: **${result.remaining}/3**.`);
        }

        const entitled = await userHasPet(guildId, ctx.user.id);

        if (action === 'status' || action === 'show') {
          const rem = guildPets?.getGrantRemaining && canManagePetGrants(ctx.member)
            ? await guildPets.getGrantRemaining(guildId)
            : null;
          const av = store.get(ctx.user.id);
          const pet = av.pet || { kind: null, enabled: false };
          const lines = [
            entitled
              ? (pet.enabled && pet.kind
                ? `🐾 Equipped **${pet.kind}** — follows you on the map in VC.`
                : 'You have a pet entitlement — `,pet cat` or `,pet dog` to equip.')
              : petLockedReply(),
          ];
          if (rem != null) lines.push(`Staff: Pro grants remaining **${rem}/3**.`);
          return ctx.reply({ content: lines.join('\n'), ephemeral: !entitled });
        }

        if (!entitled) {
          return ctx.reply({ content: petLockedReply(), ephemeral: true });
        }

        if (action === 'off' || action === 'none' || action === 'disable') {
          await savePet(ctx.user.id, ctx.member, { kind: null, enabled: false });
          drafts.delete(ctx.user.id);
          return ctx.reply('Companion pet disabled (you still keep the entitlement).');
        }

        if (action === 'cat' || action === 'dog') {
          await savePet(ctx.user.id, ctx.member, { kind: action, enabled: true });
          drafts.delete(ctx.user.id);
          return ctx.reply(
            `🐾 Equipped a **${action}**! Join a voice channel and open the Spaces map — it'll follow you.`,
          );
        }

        return ctx.reply(
          'Usage: `,pet cat|dog|off|status` · `,pet buy` · `,pet gift @user` · `,pet grant @user` · `,pet revoke @user`',
        );
      },
    });

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
