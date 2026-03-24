/**
 * NPC Agent Controller
 * Maps OpenClaw agent events AND the new Agent Office protocol
 * to NPC behaviors in the pixel office game.
 *
 * Enhanced agent states map to NPC actions:
 *   idle       -> NPC wanders in breakroom area or stands at station
 *   writing    -> NPC sits at desk, typing (shows typing indicator)
 *   researching -> NPC at bookshelf or desk, reading
 *   executing  -> NPC at desk, working (shows working indicator)
 *   syncing    -> NPC walks between desks
 *   error      -> NPC stops, shows error indicator
 *   patrolling -> NPC walks around office (cofounder/IT)
 *   reporting  -> NPC walks to player
 */

// Map agent states to office areas
const STATE_TO_AREA = {
  idle: 'breakroom',
  writing: 'desk',
  researching: 'desk',
  executing: 'desk',
  syncing: 'desk',
  error: 'desk',
  patrolling: 'roaming',
  reporting: 'player',
};

// Breakroom area bounds (bottom-left of office)
const BREAKROOM = { xMin: 50, xMax: 280, yMin: 500, yMax: 660 };
// Desk area bounds (main office)
const DESK_AREA = { xMin: 100, xMax: 750, yMin: 100, yMax: 400 };
// Reception area
const RECEPTION = { xMin: 380, xMax: 840, yMin: 460, yMax: 660 };

class NpcAgentController {
  /**
   * @param {object} scene - The Phaser scene (OfficeScene)
   * @param {GatewayBridge} bridge - The gateway bridge instance
   */
  constructor(scene, bridge) {
    this.scene = scene;
    this.bridge = bridge;

    // Map of agentId -> { npc, state, assignedDesk, role }
    this.agentNpcs = new Map();

    // Track which NPCs are available for agent assignment
    this._availableNpcs = [];

    // Speech bubble sprites
    this._bubbles = new Map();

    // Status indicators
    this._statusIndicators = new Map();

    this._bindEvents();
  }

  /** Initialize: assign NPCs to agents based on snapshot */
  init() {
    if (this.scene.npcs) {
      this._availableNpcs = [...this.scene.npcs];
    }
    console.log(`[NpcAgentCtrl] ${this._availableNpcs.length} NPCs available for agent assignment`);
  }

  /** Get or create an agent->NPC binding */
  getOrAssignNpc(agentId, agentName) {
    if (this.agentNpcs.has(agentId)) {
      return this.agentNpcs.get(agentId);
    }

    const npc = this._availableNpcs.shift();
    if (!npc) {
      console.warn(`[NpcAgentCtrl] No available NPCs for agent ${agentId}`);
      return null;
    }

    const binding = {
      npc,
      agentId,
      agentName: agentName || agentId,
      state: 'idle',
      assignedDesk: null,
      role: null,
    };
    this.agentNpcs.set(agentId, binding);
    console.log(`[NpcAgentCtrl] Assigned NPC ${npc.texture?.key} to agent "${agentName || agentId}"`);
    return binding;
  }

  /** Update an agent's state, driving its NPC behavior */
  setAgentState(agentId, state, detail) {
    const binding = this.agentNpcs.get(agentId);
    if (!binding) return;

    const prevState = binding.state;
    binding.state = state;
    const area = STATE_TO_AREA[state] || 'breakroom';

    console.log(`[NpcAgentCtrl] Agent "${binding.agentName}" ${prevState} -> ${state} (area: ${area})`);

    const npc = binding.npc;
    if (!npc || !npc.ai) return;

    // Don't override if agent manager has taken control
    if (this.scene._agentManager && npc.ai.mode === 'agent_task') {
      // Agent manager is driving this NPC, just update bubbles
      if (detail) this._showBubble(npc, detail);
      return;
    }

    if (area === 'desk') {
      this._sendToDesk(npc, binding);
    } else if (area === 'player') {
      this._sendToPlayer(npc);
    } else {
      this._sendToBreakroom(npc);
    }

    if (detail) {
      this._showBubble(npc, detail);
    }

    // Show status indicator based on state
    this._updateStatusIndicator(npc, state);
  }

  /** Execute agent command from the new protocol */
  executeCommand(command) {
    const { agentId, action, params } = command;

    // Find or create binding
    const binding = this.getOrAssignNpc(agentId, agentId);
    if (!binding) return;

    const npc = binding.npc;
    if (!npc || !npc.ai) return;

    switch (action) {
      case 'walkTo':
        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: params.x, y: params.y };
        npc.ai.taskState = 'walking';
        break;

      case 'speak':
        this._showBubble(npc, params.text, 'speech');
        break;

      case 'think':
        this._showBubble(npc, params.text, 'thought');
        break;

      case 'emote':
        this._showEmote(npc, params.type);
        break;

      case 'useComputer':
        this._sendToDesk(npc, binding);
        this._updateStatusIndicator(npc, 'executing');
        break;

      case 'goToBreakroom':
        this._sendToBreakroom(npc);
        break;

      case 'setIdle':
        npc.body.setVelocity(0, 0);
        npc.ai.mode = 'agent_task';
        npc.ai.taskState = 'idle';
        this._clearStatusIndicator(npc);
        break;

      default:
        console.log(`[NpcAgentCtrl] Unknown command action: ${action}`);
    }
  }

  /** Show a speech/status bubble above an NPC */
  _showBubble(npc, text, style) {
    const existing = this._bubbles.get(npc);
    if (existing) {
      existing.destroy();
    }

    const isThought = style === 'thought';
    const bgColor = isThought ? '#1a1a2e' : '#1e293b';
    const textColor = isThought ? '#c4b5fd' : '#ffffff';
    const prefix = isThought ? '~ ' : '';
    const suffix = isThought ? ' ~' : '';

    const bubble = this.scene.add.text(npc.x, npc.y - 40, prefix + (text || '').slice(0, 40) + suffix, {
      fontSize: '7px',
      fontFamily: 'monospace',
      color: textColor,
      backgroundColor: bgColor,
      padding: { x: 3, y: 2 },
      align: 'center',
      wordWrap: { width: 120 },
    });
    bubble.setOrigin(0.5, 1);
    bubble.setDepth(9999);
    this._bubbles.set(npc, bubble);

    this.scene.time.delayedCall(5000, () => {
      if (this._bubbles.get(npc) === bubble) {
        bubble.destroy();
        this._bubbles.delete(npc);
      }
    });
  }

  /** Show emote above NPC */
  _showEmote(npc, type) {
    const emoteMap = { '!': '!', '?': '?', 'idea': '!', 'happy': ':)', 'error': 'X', 'done': 'v' };
    const symbol = emoteMap[type] || type || '!';

    const emote = this.scene.add.text(npc.x + 10, npc.y - 48, symbol, {
      fontSize: '10px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#fbbf24',
      backgroundColor: '#00000088',
      padding: { x: 2, y: 1 },
    });
    emote.setOrigin(0.5, 1);
    emote.setDepth(9999);

    this.scene.time.delayedCall(2500, () => {
      emote.destroy();
    });
  }

  /** Update bubble positions (call from scene update) */
  updateBubbles() {
    this._bubbles.forEach((bubble, npc) => {
      if (bubble && npc) {
        bubble.x = npc.x;
        bubble.y = npc.y - 40;
      }
    });

    this._statusIndicators.forEach((indicator, npc) => {
      if (indicator && npc) {
        indicator.x = npc.x;
        indicator.y = npc.y - 32;
      }
    });
  }

  /** Update status indicator */
  _updateStatusIndicator(npc, state) {
    this._clearStatusIndicator(npc);

    const indicators = {
      writing: { text: '...', color: '#4ade80' },
      executing: { text: '...', color: '#4ade80' },
      researching: { text: 'Reading', color: '#60a5fa' },
      syncing: { text: 'Syncing', color: '#fbbf24' },
      error: { text: 'ERR', color: '#ef4444' },
    };

    const ind = indicators[state];
    if (!ind) return;

    const indicator = this.scene.add.text(npc.x, npc.y - 32, ind.text, {
      fontSize: '6px',
      fontFamily: 'monospace',
      color: ind.color,
      backgroundColor: '#0f172a',
      padding: { x: 2, y: 1 },
    });
    indicator.setOrigin(0.5, 1);
    indicator.setDepth(9997);
    this._statusIndicators.set(npc, indicator);
  }

  _clearStatusIndicator(npc) {
    const existing = this._statusIndicators.get(npc);
    if (existing) {
      existing.destroy();
      this._statusIndicators.delete(npc);
    }
  }

  /** Send NPC to a desk area */
  _sendToDesk(npc, binding) {
    const idx = Array.from(this.agentNpcs.values()).indexOf(binding);
    const deskPositions = [
      { x: 128, y: 156 }, { x: 196, y: 156 }, { x: 388, y: 156 },
      { x: 456, y: 156 }, { x: 648, y: 156 }, { x: 716, y: 156 },
    ];
    const pos = deskPositions[idx % deskPositions.length];

    npc.ai.mode = 'agent_task';
    npc.ai.taskTarget = { x: pos.x, y: pos.y };
    npc.ai.taskState = 'walking';
  }

  /** Send NPC to player */
  _sendToPlayer(npc) {
    const player = this.scene.player;
    if (!player) return;
    npc.ai.mode = 'agent_task';
    npc.ai.taskTarget = { x: player.x + 32, y: player.y };
    npc.ai.taskState = 'walking';
  }

  /** Send NPC to wander in breakroom */
  _sendToBreakroom(npc) {
    npc.ai.mode = 'wander';
    npc.ai.wanderTarget = {
      x: BREAKROOM.xMin + Math.random() * (BREAKROOM.xMax - BREAKROOM.xMin),
      y: BREAKROOM.yMin + Math.random() * (BREAKROOM.yMax - BREAKROOM.yMin),
    };
    npc.ai.nextWanderAt = 0;
  }

  /** Bind to gateway bridge events */
  _bindEvents() {
    // Agent lifecycle events
    this.bridge.addEventListener('agent', (evt) => {
      const payload = evt.detail;
      if (!payload) return;

      const agentId = payload.agentId || payload.runId || 'default';
      const binding = this.getOrAssignNpc(agentId, payload.agentName);
      if (!binding) return;

      if (payload.stream === 'lifecycle' && payload.data) {
        if (payload.data.phase === 'start') {
          this.setAgentState(agentId, 'executing', 'Working...');
        } else if (payload.data.phase === 'end') {
          this.setAgentState(agentId, 'idle', 'Done!');
        } else if (payload.data.phase === 'error') {
          this.setAgentState(agentId, 'error', 'Error!');
          this.scene.time.delayedCall(3000, () => {
            this.setAgentState(agentId, 'idle');
          });
        }
      }

      if (payload.stream === 'assistant' && payload.data?.text) {
        this.setAgentState(agentId, 'writing', payload.data.text.slice(0, 25));
      }

      if (payload.stream === 'tool' && payload.data) {
        const toolName = payload.data.name || payload.data.tool || 'tool';
        this.setAgentState(agentId, 'executing', toolName);
      }
    });

    // Chat events
    this.bridge.addEventListener('chat', (evt) => {
      const payload = evt.detail;
      if (!payload) return;

      const agentId = payload.agentId || payload.sessionKey || 'default';
      const binding = this.getOrAssignNpc(agentId, payload.agentName);
      if (!binding) return;

      if (payload.state === 'delta') {
        this.setAgentState(agentId, 'writing', 'Typing...');
      } else if (payload.state === 'final') {
        this.setAgentState(agentId, 'idle', 'Sent!');
      }
    });

    // Presence events
    this.bridge.addEventListener('presence', (evt) => {
      // Could map presence changes to NPC visibility
    });

    // Connection state
    this.bridge.addEventListener('connected', (evt) => {
      console.log('[NpcAgentCtrl] Gateway connected');
      this._showConnectionStatus(true);
    });

    this.bridge.addEventListener('disconnected', () => {
      console.log('[NpcAgentCtrl] Gateway disconnected');
      this._showConnectionStatus(false);
    });

    // Debug: log all events
    this.bridge.addEventListener('gateway-event', (evt) => {
      const { event, payload } = evt.detail;
      if (event !== 'tick') {
        console.log(`[GatewayEvent] ${event}:`, payload);
      }
    });
  }

  /** Show connection status indicator in the game */
  _showConnectionStatus(connected) {
    if (this._statusText) {
      this._statusText.destroy();
    }
    this._statusText = this.scene.add.text(4, 4,
      connected ? 'OpenClaw: Connected' : 'OpenClaw: Disconnected', {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: connected ? '#4ade80' : '#f87171',
      backgroundColor: '#0f172a',
      padding: { x: 3, y: 2 },
    });
    this._statusText.setScrollFactor(0);
    this._statusText.setDepth(9999);
  }
}

window.NpcAgentController = NpcAgentController;
