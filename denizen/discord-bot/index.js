/**
 * Denizen Discord bot — room tracker + Bleed-parity modules.
 *
 * Env: DISCORD_BOT_TOKEN (required), DISCORD_GUILD_ID, DISCORD_FORWARD_OFFICE, …
 * Flags: --smoke | --dump
 */
'use strict';

const { createClient, attachGateway } = require('./src/gateway');
const { TrackerEngine } = require('./src/tracker');
const { handleBotChat } = require('./src/chat');
const { ConfigStore } = require('./src/core/config-store');
const { CommandRegistry } = require('./src/core/command-registry');
const { AuditBus } = require('./src/core/audit-bus');
const { EventHub } = require('./src/core/event-hub');
const { canRunCommand } = require('./src/core/permissions');
const { loadModules } = require('./src/modules/load-modules');
const { createPresenceServer } = require('./src/presence-server');

const TOKEN = String(process.env.DISCORD_BOT_TOKEN || '').trim();
const GUILD_FILTER = String(process.env.DISCORD_GUILD_ID || '').trim();
const TEXT_WINDOW_MS = Number(process.env.DISCORD_TEXT_WINDOW_MS) || 90_000;
const DUMP_INTERVAL_MS = Number(process.env.DISCORD_DUMP_INTERVAL_MS) || 0;
const FORWARD_OFFICE = String(process.env.DISCORD_FORWARD_OFFICE || '0').trim() === '1';
const BRIDGE_SECRET = String(process.env.DISCORD_BRIDGE_SECRET || '').trim();
const OFFICE_ID = String(process.env.DISCORD_OFFICE_ID || 'ceo-operator').trim();
const DENIZEN_URL = String(process.env.DENIZEN_URL || process.env.DENIZEN_PUBLIC_URL || 'http://127.0.0.1:8081')
  .trim()
  .replace(/\/$/, '');
const PREFIX = String(process.env.DISCORD_PREFIX || ',').trim() || ',';
const PRESENCE_PORT = Number(process.env.DISCORD_PRESENCE_PORT) || 5180;

const SMOKE = process.argv.includes('--smoke');
const DUMP = process.argv.includes('--dump');

if (!TOKEN) {
  console.error('[discord-bot] DISCORD_BOT_TOKEN missing (set in denizen/.env)');
  process.exit(1);
}

const tracker = new TrackerEngine({ textWindowMs: TEXT_WINDOW_MS });
const config = new ConfigStore();
const registry = new CommandRegistry({ prefix: PREFIX });
const audit = new AuditBus();
const hub = new EventHub();
const client = createClient();

const hooks = loadModules({ config, registry, hub, tracker, audit, client });

audit.on((evt) => {
  for (const fn of hooks.onAudit || []) {
    try { fn(evt); } catch (err) {
      console.error('[audit]', err.message || err);
    }
  }
});

async function forwardOffice(voiceEvt) {
  if (!FORWARD_OFFICE) return;
  const left = voiceEvt.kind === 'leave';
  const channelId = voiceEvt.toChannelId || voiceEvt.fromChannelId;
  const channelName = voiceEvt.toChannel?.name || voiceEvt.fromChannel?.name || null;
  const payload = {
    office_id: OFFICE_ID,
    event: left ? 'voice_leave' : (voiceEvt.kind === 'move' ? 'voice_move' : 'voice_join'),
    userId: voiceEvt.userId,
    displayName: voiceEvt.displayName,
    guildId: voiceEvt.guildId,
    channelId: left ? null : channelId,
    channelName: left ? null : channelName,
  };
  try {
    const res = await fetch(`${DENIZEN_URL}/api/discord/presence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-denizen-secret': BRIDGE_SECRET,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[discord-bot] office forward ${res.status}: ${text.slice(0, 160)}`);
    }
  } catch (err) {
    console.warn('[discord-bot] office forward failed:', err.message || err);
  }
}

function printSnapshot(label = 'dump') {
  const data = GUILD_FILTER ? tracker.snapshot(GUILD_FILTER) : tracker.snapshot();
  console.log(`[discord-bot] --${label}--`);
  console.log(JSON.stringify(data, null, 2));
}

async function runGuardedCommand(runner) {
  try {
    await runner();
  } catch (err) {
    console.error('[command]', err.message || err);
  }
}

let readyFired = false;
attachGateway(client, {
  guildFilter: GUILD_FILTER,
  hooks,
  onReady(c) {
    if (readyFired) return;
    readyFired = true;
    registry.bindClient(c);
    audit.attach(c);

    console.log(`[discord-bot] logged in as ${c.user.tag}`);
    console.log(`[discord-bot] bleed-parity modules loaded · prefix=\`${PREFIX}\` · officeForward=${FORWARD_OFFICE ? 'on' : 'off'}`);
    if (GUILD_FILTER) console.log(`[discord-bot] guild filter: ${GUILD_FILTER}`);
    const guilds = [...c.guilds.cache.values()];
    console.log(`[discord-bot] in ${guilds.length} guild(s): ${guilds.map((g) => g.name).join(', ') || '(none)'}`);
    console.log('[discord-bot] try `,help` or `/help` · `@Denizen rooms` for canvas tracker');

    if (SMOKE) {
      console.log('[discord-bot] smoke ok — token works');
      c.destroy();
      process.exit(0);
      return;
    }

    const guildIds = GUILD_FILTER ? [GUILD_FILTER] : guilds.map((g) => g.id);
    registry.syncSlash(c, guildIds).then((n) => {
      console.log(`[discord-bot] synced ${n} slash commands`);
    }).catch((err) => {
      console.warn('[discord-bot] slash sync failed:', err.message || err);
    });

    if (DUMP) printSnapshot('dump');
    if (DUMP_INTERVAL_MS > 0) setInterval(() => printSnapshot('interval'), DUMP_INTERVAL_MS);
    setInterval(() => tracker.tick(), 5_000);

    createPresenceServer({
      tracker,
      guildId: GUILD_FILTER,
      port: PRESENCE_PORT,
      applicationId: c.application?.id || process.env.DISCORD_APPLICATION_ID || '',
    }).listen().catch((err) => {
      console.warn('[discord-bot] presence API failed:', err.message || err);
    });
  },
  onGuildSeed(guild) {
    tracker.seedGuild(guild);
    config.get(guild.id); // ensure file exists
    console.log(`[discord-bot] seeded guild "${guild.name}" — ${guild.channels.cache.size} channels`);
  },
  onVoice(evt) {
    tracker.applyVoice(evt);
    forwardOffice(evt);
  },
  onTextActivity(evt) {
    tracker.applyTextActivity(evt);
  },
  onMessage(message) {
    // Alias expansion
    if (message.guild && !message.author.bot) {
      const cfg = config.get(message.guild.id);
      const prefix = cfg.prefix || PREFIX;
      if (message.content.startsWith(prefix)) {
        const raw = message.content.slice(prefix.length).trim();
        const [head, ...rest] = raw.split(/\s+/);
        const alias = cfg.aliases?.[String(head || '').toLowerCase()];
        if (alias) {
          message.content = `${prefix}${alias}${rest.length ? ` ${rest.join(' ')}` : ''}`;
        }
      }
    }

    runGuardedCommand(async () => {
      const handled = await registry.handlePrefixMessage(message, { config, tracker, hub });
      if (handled) return;
      await handleBotChat(message, { tracker, client });
    });
  },
  async onInteraction(interaction) {
    // Component hooks (avatar, tickets) run after this via gateway hooks.onInteraction.
    if (interaction.isChatInputCommand()) {
      const cmd = registry.get(interaction.commandName);
      if (cmd) {
        const gate = canRunCommand({
          guild: interaction.guild,
          member: interaction.member,
          user: interaction.user,
          config,
        }, cmd);
        if (!gate.ok) {
          await interaction.reply({ content: `Denied: ${gate.reason}`, ephemeral: true }).catch(() => {});
          return;
        }
      }
      await registry.handleInteraction(interaction, { config, tracker, hub });
    }
  },
});

client.login(TOKEN).catch((err) => {
  console.error('[discord-bot] login failed:', err.message || err);
  process.exit(1);
});

module.exports = { tracker, client, config, registry, hub };
