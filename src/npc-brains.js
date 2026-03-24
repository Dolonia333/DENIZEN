/**
 * NPC Brain System
 * Each NPC has their own AI brain powered by a different API provider.
 * When an NPC needs to respond in conversation, their brain generates the reply.
 * Falls back to Claude if the assigned provider fails.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class NpcBrainManager {
  constructor() {
    this.providers = {};   // provider configs loaded from openclaw.json
    this.brains = {};      // npcName -> NpcBrain instance
    this.memories = {};    // npcName -> conversation history array

    this._loadProviders();
    this._initBrains();
  }

  _loadProviders() {
    try {
      const configPath = path.join(
        process.env.USERPROFILE || process.env.HOME || '',
        '.openclaw', 'openclaw.json'
      );
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const p = config?.models?.providers || {};

      // Map each provider to a simple config
      if (p.anthropic?.apiKey) {
        this.providers.claude = {
          baseUrl: 'https://api.anthropic.com',
          apiKey: p.anthropic.apiKey,
          model: 'claude-3-haiku-20240307',
          type: 'anthropic',
        };
      }
      if (p.google?.apiKey) {
        this.providers.gemini = {
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: p.google.apiKey,
          model: 'gemini-2.0-flash',
          type: 'google',
        };
      }
      if (p.xai?.apiKey) {
        this.providers.grok = {
          baseUrl: 'https://api.x.ai',
          apiKey: p.xai.apiKey,
          model: 'grok-3-mini-beta',
          type: 'openai',
        };
      }
      if (p.moonshot?.apiKey) {
        this.providers.kimi = {
          baseUrl: p.moonshot.baseUrl || 'https://api.moonshot.cn',
          apiKey: p.moonshot.apiKey,
          model: 'moonshot-v1-8k',
          type: 'openai',
        };
      }

      console.log(`[NpcBrains] Loaded providers: ${Object.keys(this.providers).join(', ')}`);
    } catch (err) {
      console.warn('[NpcBrains] Failed to load providers:', err.message);
    }
  }

  _initBrains() {
    // NPC -> Provider mapping + personality
    const npcConfigs = {
      Abby: {
        provider: 'claude',
        role: 'CTO',
        personality: 'You are Abby, the CTO. Confident leader, strategic thinker. You manage the team, review architecture decisions, and keep everyone focused. You care about code quality and team morale.',
      },
      Alex: {
        provider: 'grok',
        role: 'Developer',
        personality: 'You are Alex, a senior developer. Fast, confident, loves solving hard problems. You write clean code and enjoy debugging. You\'re competitive but supportive of teammates.',
      },
      Bob: {
        provider: 'gemini',
        role: 'Researcher',
        personality: 'You are Bob, the researcher. Thoughtful, analytical, detail-oriented. You dig deep into problems, read documentation thoroughly, and always back your opinions with data.',
      },
      Jenny: {
        provider: 'claude',
        role: 'Developer',
        personality: 'You are Jenny, a developer. Friendly, detail-oriented, great at code review. You catch bugs others miss and write excellent tests. You\'re the team\'s quality gatekeeper.',
      },
      Dan: {
        provider: 'kimi',
        role: 'IT Support',
        personality: 'You are Dan, IT support. Quiet but reliable. You keep servers running, fix network issues, and set up dev environments. You speak concisely and prefer actions over words.',
      },
      Lucy: {
        provider: 'claude',
        role: 'Receptionist',
        personality: 'You are Lucy, the receptionist. Warm, organized, keeps the office running smoothly. You manage schedules, greet visitors, and keep everyone informed about meetings and deadlines.',
      },
    };

    for (const [name, config] of Object.entries(npcConfigs)) {
      // Use assigned provider, fall back to claude
      const provider = this.providers[config.provider] || this.providers.claude;
      if (!provider) continue;

      this.brains[name] = {
        ...config,
        providerConfig: provider,
        fallbackConfig: this.providers.claude,
      };
      this.memories[name] = [];
      console.log(`[NpcBrains] ${name} (${config.role}) -> ${config.provider}${!this.providers[config.provider] ? ' (fallback: claude)' : ''}`);
    }
  }

  /**
   * Generate a response for an NPC in a conversation.
   * @param {string} npcName - The NPC responding (e.g., "Alex")
   * @param {string} fromName - Who's talking to them (e.g., "Abby")
   * @param {string} message - What was said to them
   * @param {object} context - Office context (who's where, what's happening)
   * @returns {Promise<string>} The NPC's response text
   */
  async getResponse(npcName, fromName, message, context = {}) {
    const brain = this.brains[npcName];
    if (!brain) return `(${npcName} nods)`;

    const systemPrompt = `${brain.personality}

You are in a pixel art office game. You're having a conversation at work.
Your role: ${brain.role}. Keep responses SHORT (under 40 characters). Be natural, like a real coworker.
${context.description || ''}

Respond in character as ${npcName}. Just the dialogue text, nothing else.`;

    // Add to memory
    this.memories[npcName].push({ from: fromName, text: message });
    if (this.memories[npcName].length > 20) {
      this.memories[npcName] = this.memories[npcName].slice(-20);
    }

    // Build conversation from memory
    const messages = this.memories[npcName].map(m => ({
      role: m.from === npcName ? 'assistant' : 'user',
      content: m.from === npcName ? m.text : `${m.from} says: "${m.text}"`,
    }));

    try {
      const response = await this._callProvider(brain.providerConfig, systemPrompt, messages);
      // Store response in memory
      this.memories[npcName].push({ from: npcName, text: response });
      return response;
    } catch (err) {
      // Throttle error logging — only log once per NPC per 60 seconds
      const now = Date.now();
      const lastErr = this._lastErrorLog?.[npcName] || 0;
      if (now - lastErr > 60000) {
        console.warn(`[NpcBrains] ${npcName}'s provider failed: ${err.message.slice(0, 80)}`);
        if (!this._lastErrorLog) this._lastErrorLog = {};
        this._lastErrorLog[npcName] = now;
      }
      // Try fallback
      if (brain.fallbackConfig && brain.fallbackConfig !== brain.providerConfig) {
        try {
          const response = await this._callProvider(brain.fallbackConfig, systemPrompt, messages);
          this.memories[npcName].push({ from: npcName, text: response });
          return response;
        } catch (e2) {
          console.warn(`[NpcBrains] ${npcName} fallback also failed: ${e2.message}`);
        }
      }
      // Last resort: canned response
      const canned = [
        'Got it, on it!', 'Sure thing.', 'Working on that.',
        'Sounds good.', 'Let me check.', 'Almost done.',
      ];
      return canned[Math.floor(Math.random() * canned.length)];
    }
  }

  /**
   * Call an AI provider API
   */
  _callProvider(config, systemPrompt, messages) {
    if (config.type === 'anthropic') {
      return this._callAnthropic(config, systemPrompt, messages);
    } else if (config.type === 'google') {
      return this._callGoogle(config, systemPrompt, messages);
    } else if (config.type === 'openai') {
      return this._callOpenAI(config, systemPrompt, messages);
    }
    return Promise.reject(new Error('Unknown provider type'));
  }

  _callAnthropic(config, systemPrompt, messages) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: config.model,
        max_tokens: 100,
        system: systemPrompt,
        messages: messages.length > 0 ? messages : [{ role: 'user', content: 'Introduce yourself briefly.' }],
      });

      const url = new URL('/v1/messages', config.baseUrl);
      const req = https.request({
        hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': config.apiKey,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) return reject(new Error(p.error.message));
            resolve((p.content?.[0]?.text || '').trim().slice(0, 60));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
      req.write(body);
      req.end();
    });
  }

  _callGoogle(config, systemPrompt, messages) {
    return new Promise((resolve, reject) => {
      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: 'Introduce yourself briefly.' }] });
      }

      const body = JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 60 },
      });

      const url = new URL(
        `/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
        config.baseUrl
      );
      const req = https.request({
        hostname: url.hostname, port: 443, path: url.pathname + url.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) return reject(new Error(p.error.message));
            const text = p.candidates?.[0]?.content?.parts?.[0]?.text || '';
            resolve(text.trim().slice(0, 60));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
      req.write(body);
      req.end();
    });
  }

  _callOpenAI(config, systemPrompt, messages) {
    return new Promise((resolve, reject) => {
      const oaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ];
      if (messages.length === 0) {
        oaiMessages.push({ role: 'user', content: 'Introduce yourself briefly.' });
      }

      const body = JSON.stringify({
        model: config.model,
        max_tokens: 60,
        messages: oaiMessages,
      });

      const url = new URL('/v1/chat/completions', config.baseUrl);
      const req = https.request({
        hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) return reject(new Error(p.error.message || JSON.stringify(p.error)));
            resolve((p.choices?.[0]?.message?.content || '').trim().slice(0, 60));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
      req.write(body);
      req.end();
    });
  }

  /**
   * Get memory summary for an NPC (for context in conversations)
   */
  getMemorySummary(npcName) {
    const mem = this.memories[npcName] || [];
    if (mem.length === 0) return 'No recent conversations.';
    const recent = mem.slice(-5).map(m => `${m.from}: "${m.text}"`).join(' | ');
    return `Recent: ${recent}`;
  }
}

module.exports = NpcBrainManager;
