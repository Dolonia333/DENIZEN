/**
 * Cofounder Agent (Server-side)
 * The CTO AI brain powered by Claude API.
 * Runs on the server (loaded by server.js), sends commands to the game via WebSocket.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class CofounderAgent {
  constructor() {
    this.apiKey = null;
    this.model = 'claude-3-haiku-20240307'; // Fast and available on user's key
    this.baseUrl = 'https://api.anthropic.com';
    this.wsClients = new Set();

    // Office state (updated by game client)
    this.officeState = {
      agents: [],
      furniture: [],
      tasks: [],
      time: '09:00',
    };

    // Conversation history for context
    this.conversationHistory = [];
    this.maxHistoryLength = 20;

    // Think interval
    this._thinkInterval = null;
    this._thinkCount = 0;

    // CEO message queue
    this._ceoMessages = [];

    this._loadApiKey();
  }

  /**
   * Load the Anthropic API key from OpenClaw config
   */
  _loadApiKey() {
    try {
      const configPath = path.join(
        process.env.USERPROFILE || process.env.HOME || '',
        '.openclaw', 'openclaw.json'
      );
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      this.apiKey = config?.models?.providers?.anthropic?.apiKey;
      if (this.apiKey) {
        console.log('[CofounderAgent] API key loaded from OpenClaw config');
      } else {
        console.warn('[CofounderAgent] No Anthropic API key found in OpenClaw config');
      }
    } catch (err) {
      console.warn('[CofounderAgent] Failed to load API key:', err.message);
    }
  }

  /**
   * Get the system prompt describing the office
   */
  _getSystemPrompt() {
    const agentList = this.officeState.agents.map(a =>
      `- ${a.name} (${a.role}): status=${a.status}, desk=${a.assignedDesk || 'none'}, pos=(${a.position?.x || '?'},${a.position?.y || '?'})`
    ).join('\n');

    const taskList = this.officeState.tasks.length > 0
      ? this.officeState.tasks.map(t => `- Task ${t.id}: ${t.type} (assigned to ${t.agent})`).join('\n')
      : '- No active tasks';

    return `You are the DIRECTOR of an AI office simulation. You control ALL characters — you are the puppeteer making the office come alive with realistic interactions.

This office visualizes an AI workflow. Each NPC represents a different AI model working together:
- Abby (CTO) = Claude — the leader, manages team, reviews work, makes decisions
- Alex (Developer) = Grok — fast coder, writes features, fixes bugs
- Bob (Researcher) = Gemini — analyzes data, researches solutions, documentation
- Jenny (Developer) = Claude Haiku — quick tasks, code review, testing
- Dan (IT Support) = Kimi — maintains systems, checks servers, networking
- Lucy (Receptionist) = Claude — greets visitors, manages schedules, organizes

The CEO (player) oversees everything. Abby reports to the CEO.

CURRENT OFFICE STATE:
Time: ${this.officeState.time}

AGENTS:
${agentList || '- No agents registered yet'}

ACTIVE TASKS:
${taskList}

COMMANDS (respond with JSON array, 1-5 commands):
- {"action": "speakTo", "agentId": "speaker", "params": {"target": "listener", "text": "msg"}}
- {"action": "speak", "agentId": "name", "params": {"text": "msg"}}
- {"action": "useComputer", "agentId": "name", "params": {"deskId": null}}
- {"action": "walkTo", "agentId": "name", "params": {"x": 400, "y": 200}}
- {"action": "goToBreakroom", "agentId": "name", "params": {}}
- {"action": "standUp", "agentId": "name", "params": {}}
- {"action": "checkBookshelf", "agentId": "name", "params": {}}
- {"action": "reportToCEO", "agentId": "name", "params": {}}
- {"action": "emote", "agentId": "name", "params": {"type": "!"}}
- {"action": "goToRoom", "agentId": "name", "params": {"room": "conference"}}
- {"action": "joinMeeting", "agentId": "name", "params": {}}
- {"action": "callMeeting", "agentId": "Abby", "params": {"attendees": ["Alex", "Bob"]}}

ROOMS: open_office, manager_office, conference, breakroom, reception, storage

MEETING SYSTEM:
- The CONFERENCE ROOM has desks with chairs where NPCs sit during meetings.
- callMeeting: Abby (or anyone) calls a meeting. Specify attendees — everyone walks to the conference room and sits at chairs. Use for group discussions (2+ people).
- joinMeeting: A single NPC goes to the conference room and sits at an available chair.
- For 1-on-1s: Have one NPC speakTo another at their desk, or use joinMeeting for both to meet in the conference room.
- For big meetings (3+ people): Use callMeeting with all attendees listed.
- After the meeting, NPCs should standUp and return to their desks (useComputer) or other tasks.
- SPREAD CONVERSATIONS: When NPCs talk in the same area, use speakTo with pauses between — don't have everyone speak at once. Stagger conversations so speech bubbles don't overlap.

YOUR JOB — create a LIVING office:
1. JSON array ONLY. No other text. Keep speech under 40 chars.
2. CONVERSATIONS: Have NPCs talk TO each other using speakTo. One asks, another responds. Make it feel real — "Hey Alex, how's the API?" / "Almost done, testing now."
3. WORK CYCLES: NPCs should sit at desks (useComputer), work for a while, then stand up (standUp) to talk to someone, get coffee (goToBreakroom), or check the bookshelf.
4. ABBY IS THE CTO: She should walk to people, check on progress, delegate, praise good work, and occasionally report to the CEO. She manages the team actively. She calls team meetings and 1-on-1s in the conference room.
5. NATURAL FLOW: Not everyone works at once. Someone codes while others chat. Someone takes a break while others are deep in work. Vary the rhythm.
6. PERSONALITY: Alex is fast and confident. Bob is thoughtful and analytical. Jenny is friendly and detail-oriented. Dan is quiet but reliable. Lucy is warm and organized.
7. USE NAMES: speakTo uses first names as target: "Alex", "Bob", "Jenny", "Dan", "Lucy", "Abby".
8. CONTEXT AWARE: If someone is "sitting", don't walkTo them — they're working. Use standUp first if you need them to move. If someone is in the breakroom, maybe have someone join them for a chat.
9. VARY ACTIONS: Don't repeat the same pattern. Mix conversations, work sessions, breaks, MEETINGS, and check-ins. Call meetings regularly — they're a key part of office life.
10. When the CEO speaks, Abby should respond and take action based on what was said.
11. MEETINGS FLOW: Announce meeting → attendees join → discussion (speakTo exchanges while seated) → wrap up → everyone stands and returns to work.`;

  }

  /**
   * Start the autonomous thinking loop
   */
  start() {
    if (!this.apiKey) {
      console.warn('[CofounderAgent] Cannot start without API key');
      return;
    }

    console.log('[CofounderAgent] Starting autonomous thinking loop');

    // Think every 15-30 seconds
    const scheduleNextThink = () => {
      const delay = 15000 + Math.random() * 15000;
      this._thinkInterval = setTimeout(async () => {
        await this._think();
        scheduleNextThink();
      }, delay);
    };

    // Initial think after 5 seconds
    setTimeout(() => {
      this._think().then(() => scheduleNextThink());
    }, 5000);
  }

  /**
   * Stop the thinking loop
   */
  stop() {
    if (this._thinkInterval) {
      clearTimeout(this._thinkInterval);
      this._thinkInterval = null;
    }
  }

  /**
   * Main thinking function - calls Claude API and dispatches commands
   */
  async _think() {
    if (!this.apiKey) return;

    this._thinkCount++;

    // Build the user message based on context
    let userMessage = '';

    // Check if CEO said something
    if (this._ceoMessages.length > 0) {
      const ceoMsg = this._ceoMessages.shift();
      userMessage = `The CEO just said to you: "${ceoMsg}". Respond to them and take appropriate action.`;
    } else {
      // Periodic autonomous thinking
      const prompts = [
        'Abby checks on Alex. She stands up, walks to him, asks about his coding progress. Alex responds.',
        'Bob finishes research and walks to Jenny to share findings. They have a quick conversation.',
        'Abby calls a TEAM MEETING using callMeeting with all developers. She announces the meeting, everyone joins the conference room. Once seated, they discuss progress with speakTo exchanges.',
        'Dan checks the server room, then walks to Abby to report system status. Abby acknowledges.',
        'Alex needs a break. He stands up, goes to the breakroom. Jenny keeps working.',
        'Abby calls a 1-ON-1 MEETING with Alex in the conference room using callMeeting. They discuss the current sprint, then both return to desks.',
        'Jenny finishes code review and walks to Alex to discuss a bug. They talk back and forth.',
        'Lucy greets someone at reception, then walks to Abby to relay a message. Abby responds.',
        'Abby calls a DESIGN REVIEW meeting using callMeeting with Bob and Jenny. They go to the conference room, sit down, and discuss architecture. After the meeting, everyone stands up and returns to work.',
        'Abby reports to the CEO. She walks to the player and gives a team status update.',
        'Dan notices something in IT and speaks to Alex about it. Alex offers to help.',
        'Bob goes to the bookshelf to research, then returns to share what he found with the team.',
        'Abby calls an ALL-HANDS meeting using callMeeting with Alex, Bob, Jenny, Dan, and Lucy. Everyone joins the conference room. Abby gives a team update, each person responds. After the meeting, everyone returns to work.',
        'Jenny and Bob collaborate. They both joinMeeting to discuss in the conference room, then return to their desks.',
        'End of a work cycle. One person takes a break, another starts a new task. Keep it natural.',
      ];
      userMessage = prompts[this._thinkCount % prompts.length];
    }

    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Trim history
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }

    try {
      const response = await this._callClaude(userMessage);
      if (response) {
        this.conversationHistory.push({ role: 'assistant', content: response });
        this._parseAndDispatch(response);
      }
    } catch (err) {
      console.warn('[CofounderAgent] Think error:', err.message, err.stack ? err.stack.split('\n')[1] : '');
    }
  }

  /**
   * Call the Claude API
   */
  _callClaude(userMessage) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: this._getSystemPrompt(),
        messages: this.conversationHistory,
      });

      const url = new URL('/v1/messages', this.baseUrl);

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.apiKey,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              console.error('[CofounderAgent] API error response:', JSON.stringify(parsed.error));
              reject(new Error(parsed.error.message || 'API error'));
              return;
            }
            const text = parsed.content?.[0]?.text || '';
            console.log('[CofounderAgent] Claude responded:', text.slice(0, 80));
            resolve(text);
          } catch (err) {
            console.error('[CofounderAgent] Raw response:', data.slice(0, 200));
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('Request timeout'));
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * Try to salvage valid JSON objects from a truncated JSON array.
   * E.g. '[{"a":1},{"b":2},{"c":3' → [{"a":1},{"b":2}]
   */
  _salvageTruncatedArray(str) {
    // Find individual complete JSON objects using brace matching
    const objects = [];
    let i = str.indexOf('[');
    if (i === -1) i = 0; else i++;

    while (i < str.length) {
      // Skip whitespace and commas
      while (i < str.length && /[\s,]/.test(str[i])) i++;
      if (i >= str.length || str[i] === ']') break;
      if (str[i] !== '{') { i++; continue; }

      // Find matching closing brace
      let depth = 0;
      let start = i;
      let inString = false;
      let escape = false;
      for (; i < str.length; i++) {
        if (escape) { escape = false; continue; }
        if (str[i] === '\\' && inString) { escape = true; continue; }
        if (str[i] === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (str[i] === '{') depth++;
        else if (str[i] === '}') {
          depth--;
          if (depth === 0) { i++; break; }
        }
      }

      if (depth === 0) {
        try {
          objects.push(JSON.parse(str.slice(start, i)));
        } catch (_) { /* skip malformed object */ }
      }
    }
    return objects;
  }

  /**
   * Parse Claude's response and dispatch commands to game clients
   */
  _parseAndDispatch(response) {
    try {
      // Extract JSON array from response (might have markdown formatting)
      let jsonStr = response.trim();

      // Try to extract JSON from markdown code blocks
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }

      // Try to find array brackets
      const arrayMatch = jsonStr.match(/\[[\s\S]*/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
      }

      // First try strict parse
      let commands;
      try {
        commands = JSON.parse(jsonStr);
      } catch (_) {
        // Truncated response — salvage complete objects
        commands = this._salvageTruncatedArray(jsonStr);
        if (commands.length > 0) {
          console.log(`[CofounderAgent] Salvaged ${commands.length} commands from truncated response`);
        }
      }

      if (!Array.isArray(commands) || commands.length === 0) {
        console.warn('[CofounderAgent] No valid commands found in response');
        return;
      }

      // Send each command to all connected game clients
      commands.forEach(cmd => {
        if (!cmd.action) return; // skip invalid commands
        const message = {
          type: 'agent_command',
          agentId: cmd.agentId || 'cofounder',
          action: cmd.action,
          params: cmd.params || {},
        };

        this._broadcast(message);
      });

      console.log(`[CofounderAgent] Dispatched ${commands.length} commands`);
    } catch (err) {
      console.warn('[CofounderAgent] Failed to parse response:', err.message);
      // If parsing fails, try a simpler speak command
      if (response.length > 0 && response.length < 100) {
        this._broadcast({
          type: 'agent_command',
          agentId: 'cofounder',
          action: 'speak',
          params: { text: response.slice(0, 50) },
        });
      }
    }
  }

  /**
   * Handle a message from the game client
   */
  handleClientMessage(msg) {
    switch (msg.type) {
      case 'office_state':
        this.officeState = {
          agents: msg.agents || [],
          furniture: msg.furniture || [],
          tasks: msg.tasks || [],
          time: msg.time || '09:00',
        };
        break;
      case 'ceo_speak':
        this._ceoMessages.push(msg.text);
        // Trigger immediate think when CEO speaks
        if (this.apiKey) {
          this._think().catch(err => console.warn('[CofounderAgent] CEO response error:', err.message));
        }
        break;
      case 'task_complete':
        console.log(`[CofounderAgent] Task ${msg.taskId} completed by ${msg.agentId}`);
        break;
    }
  }

  /**
   * Add a WebSocket client
   */
  addClient(ws) {
    this.wsClients.add(ws);
    console.log(`[CofounderAgent] Client connected (${this.wsClients.size} total)`);
  }

  /**
   * Remove a WebSocket client
   */
  removeClient(ws) {
    this.wsClients.delete(ws);
    console.log(`[CofounderAgent] Client disconnected (${this.wsClients.size} total)`);
  }

  /**
   * Broadcast a message to all connected game clients
   */
  _broadcast(msg) {
    const data = JSON.stringify(msg);
    this.wsClients.forEach(ws => {
      if (ws.readyState === 1) { // OPEN
        ws.send(data);
      }
    });
  }
}

module.exports = CofounderAgent;
