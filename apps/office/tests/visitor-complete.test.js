'use strict';
/**
 * 100% completion gate for the Denizen visitor assistant subsystem.
 * Verifies files, wiring, exports, routes, brain hooks, module load, and health payload.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** Resolve module basename to path relative to src/ after folder reorg. */
const SRC_MODULE_INDEX = {
  "RoomAssembly.js": "city/RoomAssembly.js",
  "RoomBuilder.js": "city/RoomBuilder.js",
  "RoomGenerator.js": "RoomGenerator.js",
  "agent-bus.js": "agent-bus.js",
  "denizen-demo-auth.js": "auth/denizen-demo-auth.js",
  "denizen-org-npc-team.js": "auth/denizen-org-npc-team.js",
  "denizen-org-policy.js": "auth/denizen-org-policy.js",
  "denizen-team-auth.js": "auth/denizen-team-auth.js",
  "denizen-team-invite-links.js": "auth/denizen-team-invite-links.js",
  "denizen-team-password.js": "auth/denizen-team-password.js",
  "denizen-user-identity.js": "auth/denizen-user-identity.js",
  "denizen-user-position.js": "auth/denizen-user-position.js",
  "chat-bootstrap.js": "chat-bootstrap.js",
  "RoomAssemblyIntegration.js": "city/RoomAssemblyIntegration.js",
  "city-debug.js": "city/city-debug.js",
  "cityGenerator.js": "city/cityGenerator.js",
  "cityTypes.js": "city/cityTypes.js",
  "interiorGenerator.js": "city/interiorGenerator.js",
  "phaserAdapter.js": "city/phaserAdapter.js",
  "planner.js": "city/planner.js",
  "cloud-vm-provider.js": "compute/cloud-vm-provider.js",
  "cofounder-agent.js": "compute/cofounder-agent.js",
  "computer-use-agent.js": "compute/computer-use-agent.js",
  "cost-projector.js": "compute/cost-projector.js",
  "denizen-approvals-scope.js": "compute/denizen-approvals-scope.js",
  "denizen-bouncer-mesh-patrol.js": "compute/denizen-bouncer-mesh-patrol.js",
  "denizen-bouncer-patrol-aggregate.js": "compute/denizen-bouncer-patrol-aggregate.js",
  "denizen-business-context.js": "compute/denizen-business-context.js",
  "denizen-companion-api.js": "compute/denizen-companion-api.js",
  "denizen-compute-credits.js": "compute/denizen-compute-credits.js",
  "denizen-compute-platform.js": "compute/denizen-compute-platform.js",
  "denizen-compute-producer.js": "compute/denizen-compute-producer.js",
  "denizen-compute-queue.js": "compute/denizen-compute-queue.js",
  "denizen-compute-routes.js": "compute/denizen-compute-routes.js",
  "denizen-compute-settlement.js": "compute/denizen-compute-settlement.js",
  "denizen-contribution-tracker.js": "compute/denizen-contribution-tracker.js",
  "denizen-credits.js": "compute/denizen-credits.js",
  "denizen-embedding-worker.js": "compute/denizen-embedding-worker.js",
  "denizen-hardware-monitor.js": "compute/denizen-hardware-monitor.js",
  "denizen-host-compute.js": "compute/denizen-host-compute.js",
  "denizen-inference-metrics.js": "compute/denizen-inference-metrics.js",
  "denizen-inference-progress.js": "compute/denizen-inference-progress.js",
  "denizen-inference-rpc.js": "compute/denizen-inference-rpc.js",
  "denizen-inference-runtime.js": "compute/denizen-inference-runtime.js",
  "denizen-mesh-job-runner.js": "compute/denizen-mesh-job-runner.js",
  "denizen-mesh-telemetry-worker.js": "compute/denizen-mesh-telemetry-worker.js",
  "denizen-prompt-budget.js": "compute/denizen-prompt-budget.js",
  "denizen-sim-tick.js": "compute/denizen-sim-tick.js",
  "desktop-agent.js": "compute/desktop-agent.js",
  "desktop-permission-bridge.js": "compute/desktop-permission-bridge.js",
  "file-agent.js": "compute/file-agent.js",
  "health-runbook.js": "compute/health-runbook.js",
  "live-infra-brief.js": "compute/live-infra-brief.js",
  "lucy-browser-stream.js": "compute/lucy-browser-stream.js",
  "lucy-search-brief.js": "compute/lucy-search-brief.js",
  "mesh-scale-advisor.js": "compute/mesh-scale-advisor.js",
  "mesh-worker-watchdog.js": "compute/mesh-worker-watchdog.js",
  "office-status-brief.js": "compute/office-status-brief.js",
  "resource-pressure.js": "compute/resource-pressure.js",
  "vm-sandbox.js": "compute/vm-sandbox.js",
  "denizen-npc-mcp-gateway.js": "core/denizen-npc-mcp-gateway.js",
  "format-provider-error.js": "core/format-provider-error.js",
  "denizen-crm-assist.js": "crm/denizen-crm-assist.js",
  "denizen-crm-automations.js": "crm/denizen-crm-automations.js",
  "denizen-crm-calendar.js": "crm/denizen-crm-calendar.js",
  "denizen-crm-chat-actions.js": "crm/denizen-crm-chat-actions.js",
  "denizen-crm-digest.js": "crm/denizen-crm-digest.js",
  "denizen-crm-email.js": "crm/denizen-crm-email.js",
  "denizen-crm-handoffs.js": "crm/denizen-crm-handoffs.js",
  "denizen-crm-industry-bridge.js": "crm/denizen-crm-industry-bridge.js",
  "denizen-crm-intake-public.js": "crm/denizen-crm-intake-public.js",
  "denizen-crm-metrics.js": "crm/denizen-crm-metrics.js",
  "denizen-crm-mutations.js": "crm/denizen-crm-mutations.js",
  "denizen-crm-npc-personas.js": "crm/denizen-crm-npc-personas.js",
  "denizen-crm-operator.js": "crm/denizen-crm-operator.js",
  "denizen-crm-portal.js": "crm/denizen-crm-portal.js",
  "denizen-crm-resend-webhook.js": "crm/denizen-crm-resend-webhook.js",
  "denizen-crm-routes.js": "crm/denizen-crm-routes.js",
  "denizen-crm-scheduler.js": "crm/denizen-crm-scheduler.js",
  "denizen-crm-sequences.js": "crm/denizen-crm-sequences.js",
  "denizen-crm-setup-wizard.js": "crm/denizen-crm-setup-wizard.js",
  "denizen-crm-setup.js": "crm/denizen-crm-setup.js",
  "denizen-crm-skills.js": "crm/denizen-crm-skills.js",
  "denizen-crm-spine.js": "crm/denizen-crm-spine.js",
  "denizen-crm-store.js": "crm/denizen-crm-store.js",
  "denizen-crm-stripe.js": "crm/denizen-crm-stripe.js",
  "denizen-crm-team-invite.js": "crm/denizen-crm-team-invite.js",
  "denizen-crm-webhooks.js": "crm/denizen-crm-webhooks.js",
  "demo-roster.js": "demo-roster.js",
  "demo-scene.js": "demo-scene.js",
  "denizen-lazy-scripts.js": "denizen-lazy-scripts.js",
  "denizen-desktop-downloads.js": "desktop/denizen-desktop-downloads.js",
  "denizen-desktop-feedback.js": "desktop/denizen-desktop-feedback.js",
  "denizen-desktop-link.js": "desktop/denizen-desktop-link.js",
  "denizen-desktop-pairing.js": "desktop/denizen-desktop-pairing.js",
  "denizen-desktop-permissions.js": "desktop/denizen-desktop-permissions.js",
  "device-profile.js": "device-profile.js",
  "freeze-watchdog.js": "freeze-watchdog.js",
  "gateway-bridge.js": "gateway-bridge.js",
  "assistant-mode.js": "hud/assistant-mode.js",
  "bottom-dock.js": "hud/bottom-dock.js",
  "chat-attachments.js": "hud/chat-attachments.js",
  "denizen-phone-chat-ui.js": "hud/denizen-phone-chat-ui.js",
  "denizen-phone-ui.js": "hud/denizen-phone-ui.js",
  "diag.js": "hud/diag.js",
  "mesh-alert-toast.js": "hud/mesh-alert-toast.js",
  "mobile-controls.js": "hud/mobile-controls.js",
  "mobile-haptics.js": "hud/mobile-haptics.js",
  "mobile-sidebar.js": "hud/mobile-sidebar.js",
  "browser-mirror-panel.js": "hud/panels/browser-mirror-panel.js",
  "content-pipeline-panel.js": "hud/panels/content-pipeline-panel.js",
  "llm-telemetry-panel.js": "hud/panels/llm-telemetry-panel.js",
  "mesh-jobs-panel.js": "hud/panels/mesh-jobs-panel.js",
  "proposals-panel.js": "hud/panels/proposals-panel.js",
  "player-chat-skill-bridge.js": "hud/player-chat-skill-bridge.js",
  "player-chat.js": "hud/player-chat.js",
  "work-feed.js": "hud/work-feed.js",
  "denizen-agent-ws-relay.js": "integrations/denizen-agent-ws-relay.js",
  "denizen-federation.js": "integrations/denizen-federation.js",
  "denizen-fleet-agent-bundle.js": "integrations/denizen-fleet-agent-bundle.js",
  "denizen-fleet-registry.js": "integrations/denizen-fleet-registry.js",
  "denizen-invite-platform.js": "integrations/denizen-invite-platform.js",
  "denizen-local-agent.js": "integrations/denizen-local-agent.js",
  "denizen-market-scheduler.js": "integrations/denizen-market-scheduler.js",
  "denizen-node-client.js": "integrations/denizen-node-client.js",
  "denizen-node-profiler.js": "integrations/denizen-node-profiler.js",
  "denizen-node-worker.js": "integrations/denizen-node-worker.js",
  "denizen-security-relay.js": "integrations/denizen-security-relay.js",
  "denizen-slack-channel.js": "integrations/denizen-slack-channel.js",
  "denizen-world-pubsub.js": "integrations/denizen-world-pubsub.js",
  "lm-studio-advertise.js": "integrations/lm-studio-advertise.js",
  "lm-studio-probe.js": "integrations/lm-studio-probe.js",
  "lm-studio-remediator.js": "integrations/lm-studio-remediator.js",
  "lm-studio-router.js": "integrations/lm-studio-router.js",
  "market-data.js": "integrations/market-data.js",
  "n8n-client.js": "integrations/n8n-client.js",
  "n8n-routes.js": "integrations/n8n-routes.js",
  "nas-connect.js": "integrations/nas-connect.js",
  "platform-bridge.js": "integrations/platform-bridge.js",
  "robinhood-mcp.js": "integrations/robinhood-mcp.js",
  "away-notify.js": "intelligence/away-notify.js",
  "denizen-db.js": "intelligence/denizen-db.js",
  "denizen-mentor-dialogue.js": "intelligence/denizen-mentor-dialogue.js",
  "denizen-prediction-loop.js": "intelligence/denizen-prediction-loop.js",
  "external-sink.js": "intelligence/external-sink.js",
  "federal-pipeline.js": "intelligence/federal-pipeline.js",
  "hallucination-guard.js": "intelligence/hallucination-guard.js",
  "llm-telemetry.js": "intelligence/llm-telemetry.js",
  "mirofish-prediction.js": "intelligence/mirofish-prediction.js",
  "outcome-scorer.js": "intelligence/outcome-scorer.js",
  "prompt-tuning.js": "intelligence/prompt-tuning.js",
  "research-brief.js": "intelligence/research-brief.js",
  "research-queue.js": "intelligence/research-queue.js",
  "research-router.js": "intelligence/research-router.js",
  "research-scheduler.js": "intelligence/research-scheduler.js",
  "research-sessions.js": "intelligence/research-sessions.js",
  "telemetry-insights.js": "intelligence/telemetry-insights.js",
  "web-research.js": "intelligence/web-research.js",
  "load-env.js": "load-env.js",
  "logger.js": "logger.js",
  "denizen-mcp-actions.js": "mcp/denizen-mcp-actions.js",
  "denizen-mcp-connector.js": "mcp/denizen-mcp-connector.js",
  "denizen-mcp-crm-tools.js": "mcp/denizen-mcp-crm-tools.js",
  "denizen-mcp-cursor-tools.js": "mcp/denizen-mcp-cursor-tools.js",
  "denizen-mcp-market-tools.js": "mcp/denizen-mcp-market-tools.js",
  "denizen-mcp-mentor-tools.js": "mcp/denizen-mcp-mentor-tools.js",
  "denizen-mcp-mesh-tools.js": "mcp/denizen-mcp-mesh-tools.js",
  "denizen-mcp-oauth.js": "mcp/denizen-mcp-oauth.js",
  "denizen-mcp-resources.js": "mcp/denizen-mcp-resources.js",
  "denizen-mcp-scopes.js": "mcp/denizen-mcp-scopes.js",
  "denizen-mcp-team-gateway.js": "mcp/denizen-mcp-team-gateway.js",
  "denizen-mcp-team-tools.js": "mcp/denizen-mcp-team-tools.js",
  "movement-guard.js": "movement-guard.js",
  "agent-actions.js": "npc/agent-actions.js",
  "agent-office-manager.js": "npc/agent-office-manager.js",
  "agent-souls.js": "npc/agent-souls.js",
  "competency-map.js": "npc/competency-map.js",
  "generic-soul-pack.js": "npc/generic-soul-pack.js",
  "npc-agent-controller.js": "npc/npc-agent-controller.js",
  "npc-brains.js": "npc/npc-brains.js",
  "npc-browser-paths.js": "npc/npc-browser-paths.js",
  "npc-capabilities.js": "npc/npc-capabilities.js",
  "npc-local-metrics.js": "npc/npc-local-metrics.js",
  "npc-peer-work-status.js": "npc/npc-peer-work-status.js",
  "npc-personality-bridge.js": "npc/npc-personality-bridge.js",
  "npc-roster.js": "npc/npc-roster.js",
  "npc-team-soul.js": "npc/npc-team-soul.js",
  "npc-telemetry-rebalance.js": "npc/npc-telemetry-rebalance.js",
  "npc-think-runner.js": "npc/npc-think-runner.js",
  "npc-tools.js": "npc/npc-tools.js",
  "office-bus.js": "office-bus.js",
  "office-director.js": "office-director.js",
  "denizen-achievements.js": "office-hq/denizen-achievements.js",
  "denizen-npc-stats.js": "office-hq/denizen-npc-stats.js",
  "denizen-office-progress.js": "office-hq/denizen-office-progress.js",
  "denizen-quests.js": "office-hq/denizen-quests.js",
  "npc-leaderboard-panel.js": "office-hq/npc-leaderboard-panel.js",
  "office-hq-panel.js": "office-hq/office-hq-panel.js",
  "office-level-chip.js": "office-hq/office-level-chip.js",
  "office-quests-panel.js": "office-hq/office-quests-panel.js",
  "openclaw-chat.js": "openclaw-chat.js",
  "openclaw-dispatch.js": "openclaw-dispatch.js",
  "openclaw-translator.js": "openclaw-translator.js",
  "openclaw-worldstate-bridge.js": "openclaw-worldstate-bridge.js",
  "openplan-walls.js": "openplan-walls.js",
  "pathfinding.js": "pathfinding.js",
  "ambient-dialogue.js": "pipelines/ambient-dialogue.js",
  "animation-forge.js": "pipelines/animation-forge.js",
  "capability-proposal.js": "pipelines/capability-proposal.js",
  "coding-task-runner.js": "pipelines/coding-task-runner.js",
  "conflict-detector.js": "pipelines/conflict-detector.js",
  "content-gate.js": "pipelines/content-gate.js",
  "content-pipeline-scheduler.js": "pipelines/content-pipeline-scheduler.js",
  "content-pipeline.js": "pipelines/content-pipeline.js",
  "dossier-system.js": "pipelines/dossier-system.js",
  "email-handler.js": "pipelines/email-handler.js",
  "escalation-engine.js": "pipelines/escalation-engine.js",
  "gmail-client.js": "pipelines/gmail-client.js",
  "job-application.js": "pipelines/job-application.js",
  "job-crm.js": "pipelines/job-crm.js",
  "meeting-runner.js": "pipelines/meeting-runner.js",
  "sentiment.js": "pipelines/sentiment.js",
  "skill-builder.js": "pipelines/skill-builder.js",
  "skill-discovery.js": "pipelines/skill-discovery.js",
  "skill-gap-orchestrator.js": "pipelines/skill-gap-orchestrator.js",
  "soul-reflection.js": "pipelines/soul-reflection.js",
  "task-chain.js": "pipelines/task-chain.js",
  "task-resource-advisor.js": "pipelines/task-resource-advisor.js",
  "public-demo-mode.js": "public-demo-mode.js",
  "room-tile-renderer.js": "room-tile-renderer.js",
  "route-registry.js": "route-registry.js",
  "intelligence-routes.js": "routes/intelligence-routes.js",
  "office-progress-routes.js": "routes/office-progress-routes.js",
  "bouncer-client-init.js": "security/bouncer-client-init.js",
  "bouncer-investigation.js": "security/bouncer-investigation.js",
  "linux-agent.js": "security/linux-agent.js",
  "pc-activity-tracker.js": "security/pc-activity-tracker.js",
  "permission-registry.js": "security/permission-registry.js",
  "robber-controller.js": "security/robber-controller.js",
  "screen-observe.js": "security/screen-observe.js",
  "screen-watch.js": "security/screen-watch.js",
  "security-feed.js": "security/security-feed.js",
  "security-ip.js": "security/security-ip.js",
  "security-monitor.js": "security/security-monitor.js",
  "spectate-routing.js": "spectate-routing.js",
  "spectate-ui.js": "spectate-ui.js",
  "denizen-station-capabilities.js": "station/denizen-station-capabilities.js",
  "denizen-station-router.js": "station/denizen-station-router.js",
  "denizen-station-skill-bridge.js": "station/denizen-station-skill-bridge.js",
  "denizen-station-task-queue.js": "station/denizen-station-task-queue.js",
  "denizen-station-tokens.js": "station/denizen-station-tokens.js",
  "tabler-icons.js": "tabler-icons.js",
  "touch-bind.js": "touch-bind.js",
  "denizen-visitor-intelligence.js": "visitors/denizen-visitor-intelligence.js",
  "denizen-visitor.js": "visitors/denizen-visitor.js",
  "visitor-access.js": "visitors/visitor-access.js",
  "visitor-account-panel.js": "visitors/visitor-account-panel.js",
  "visitor-agent-inbox.js": "visitors/visitor-agent-inbox.js",
  "visitor-assistant-labels.js": "visitors/visitor-assistant-labels.js",
  "visitor-briefing-loop.js": "visitors/visitor-briefing-loop.js",
  "visitor-briefing-ui.js": "visitors/visitor-briefing-ui.js",
  "visitor-capabilities-guide.js": "visitors/visitor-capabilities-guide.js",
  "visitor-capabilities.js": "visitors/visitor-capabilities.js",
  "visitor-cited-research.js": "visitors/visitor-cited-research.js",
  "visitor-claim-ui.js": "visitors/visitor-claim-ui.js",
  "visitor-client-platform.js": "visitors/visitor-client-platform.js",
  "visitor-companion-bridge.js": "visitors/visitor-companion-bridge.js",
  "visitor-connections.js": "visitors/visitor-connections.js",
  "visitor-credits-chip.js": "visitors/visitor-credits-chip.js",
  "visitor-crm-bridge.js": "visitors/visitor-crm-bridge.js",
  "visitor-dashboard-gate.js": "visitors/visitor-dashboard-gate.js",
  "visitor-demo-account-prompt.js": "visitors/visitor-demo-account-prompt.js",
  "visitor-desktop-pairing.js": "visitors/visitor-desktop-pairing.js",
  "visitor-handoff-ui.js": "visitors/visitor-handoff-ui.js",
  "visitor-market-panel.js": "visitors/visitor-market-panel.js",
  "visitor-mcp-connect-ui.js": "visitors/visitor-mcp-connect-ui.js",
  "visitor-node-ui.js": "visitors/visitor-node-ui.js",
  "visitor-notify.js": "visitors/visitor-notify.js",
  "visitor-npc-team-ui.js": "visitors/visitor-npc-team-ui.js",
  "visitor-office-context.js": "visitors/visitor-office-context.js",
  "visitor-office-layout.js": "visitors/visitor-office-layout.js",
  "visitor-office-registry.js": "visitors/visitor-office-registry.js",
  "visitor-onboarding.js": "visitors/visitor-onboarding.js",
  "visitor-phone-station-connect.js": "visitors/visitor-phone-station-connect.js",
  "visitor-profile-ui.js": "visitors/visitor-profile-ui.js",
  "visitor-projects-ui.js": "visitors/visitor-projects-ui.js",
  "visitor-session-auth.js": "visitors/visitor-session-auth.js",
  "visitor-session-cookie.js": "visitors/visitor-session-cookie.js",
  "visitor-session.js": "visitors/visitor-session.js",
  "visitor-skill-gap-ui.js": "visitors/visitor-skill-gap-ui.js",
  "visitor-superuser-onboarding.js": "visitors/visitor-superuser-onboarding.js",
  "visitor-voice-walkup.js": "visitors/visitor-voice-walkup.js",
  "denizen-voice-bridge.js": "voice/denizen-voice-bridge.js",
  "denizen-voice-call-ui.js": "voice/denizen-voice-call-ui.js",
  "denizen-voice-playback.js": "voice/denizen-voice-playback.js",
  "denizen-voice-session.js": "voice/denizen-voice-session.js",
  "elevenlabs-provider.js": "voice/elevenlabs-provider.js",
  "elevenlabs-tts.js": "voice/elevenlabs-tts.js",
  "proximity-audio.js": "voice/proximity-audio.js",
  "sfx.js": "voice/sfx.js",
  "voice-gate.js": "voice/voice-gate.js",
  "voice-input.js": "voice/voice-input.js",
  "voice-resolve.js": "voice/voice-resolve.js",
  "voice-sentence.js": "voice/voice-sentence.js",
  "animRegistry.js": "world/animRegistry.js",
  "debug.js": "world/debug.js",
  "generator.js": "world/generator.js",
  "recipes.js": "world/recipes.js",
  "renderer.js": "world/renderer.js",
  "rng.js": "world/rng.js",
  "roomFurnisher.js": "world/roomFurnisher.js",
  "roomFurnisherRuntime.js": "world/roomFurnisherRuntime.js",
  "world-state.js": "world-state.js"
};
function resolveSrcModule(file) {
  const base = file.endsWith('.js') ? file : file + '.js';
  return SRC_MODULE_INDEX[base] || file;
}

const REQUIRED_FILES = [
  'visitor-session.js',
  'visitor-claim-ui.js',
  'visitor-handoff-ui.js',
  'visitor-projects-ui.js',
  'visitor-assistant-labels.js',
  'visitor-onboarding.js',
  'visitor-briefing-ui.js',
  'visitor-voice-walkup.js',
  'visitor-capabilities.js',
  'visitor-access.js',
  'skill-gap-orchestrator.js',
  'skill-discovery.js',
  'visitor-capabilities-guide.js',
  'visitor-superuser-onboarding.js',
  'visitor-skill-gap-ui.js',
  'visitor-agent-inbox.js',
  'visitor-dashboard-gate.js',
  'vm-sandbox.js',
  'health-runbook.js',
  'mesh-worker-watchdog.js',
  'resource-pressure.js',
  'lm-studio-remediator.js',
  'cloud-vm-provider.js',
  'mesh-scale-advisor.js',
  'visitor-session-auth.js',
  'denizen-team-auth.js',
  'denizen-org-policy.js',
  'denizen-visitor.js',
  'denizen-visitor-intelligence.js',
  'visitor-briefing-loop.js',
  'visitor-cited-research.js',
  'denizen-slack-channel.js',
  'denizen-mcp-connector.js',
  'denizen-npc-mcp-gateway.js',
  'visitor-mcp-connect-ui.js',
  'visitor-companion-bridge.js',
  'denizen-companion-api.js',
  'denizen-prediction-loop.js',
];

/** Eager in index.html — must load before player chat / scene. */
const INDEX_EAGER_SCRIPTS = [
  './src/visitors/visitor-session.js',
  './src/visitors/visitor-onboarding.js',
  './src/visitors/visitor-claim-ui.js',
  './src/denizen-lazy-scripts.js',
];

/** Deferred via denizen-lazy-scripts.js after Phaser boots. */
const INDEX_LAZY_SCRIPTS = [
  './src/visitors/visitor-capabilities.js',
  './src/visitors/visitor-dashboard-gate.js',
  './src/visitors/visitor-handoff-ui.js',
  './src/visitors/visitor-projects-ui.js',
  './src/visitors/visitor-assistant-labels.js',
];

const REQUIRED_EXPORTS = [
  'createOrUpdateSession',
  'claimAssistant',
  'releaseAssistant',
  'getAssistant',
  'listProjects',
  'sendHandoff',
  'getPendingHandoffs',
  'listTeammates',
  'getOrCreateCeoBridgeSession',
  'ensureOrgMembership',
  'getOrgContext',
];

const SERVER_ROUTE_MARKERS = [
  '/api/visitor/session',
  '/api/visitor/access/verify',
  '/api/visitor/auth/register',
  '/api/visitor/auth/login',
  '/api/org/policy',
  '/api/visitor/claim',
  '/api/visitor/assistant',
  '/api/visitor/handoff',
  '/api/visitor/connections',
  '/api/visitor/connections/request',
  '/api/visitor/connections/respond',
  '/api/visitor/projects',
  '/api/visitor/teammates',
  '/api/mcp/tokens',
  '/api/mcp/connect-info',
  '/api/npc-sync/openapi.json',
  'npcSyncMatch',
  'handleRestSync',
  'mcpNpcMatch',
  'refreshDbMemories',
  'visitor_register',
  'buildLucyHandoffAlertBroadcast',
  '/api/health/runbook',
  '/api/compute/resource-pressure',
  '/api/compute/scale-advice',
];

const NODE_MODULES = [
  'denizen-visitor.js',
  'visitor-connections.js',
  'denizen-visitor-intelligence.js',
  'visitor-briefing-loop.js',
  'visitor-cited-research.js',
  'denizen-slack-channel.js',
  'denizen-mcp-connector.js',
  'denizen-companion-api.js',
  'denizen-prediction-loop.js',
];

const BROWSER_MODULES = [
  'visitor-session.js',
  'visitor-capabilities.js',
  'visitor-claim-ui.js',
  'visitor-handoff-ui.js',
  'visitor-projects-ui.js',
  'visitor-assistant-labels.js',
  'visitor-onboarding.js',
  'visitor-briefing-ui.js',
  'visitor-voice-walkup.js',
  'visitor-mcp-connect-ui.js',
  'visitor-companion-bridge.js',
];

function readUtf8(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('visitor assistant — 100% completion gate', () => {
  it('all required source files exist', () => {
    for (const file of REQUIRED_FILES) {
      const full = path.join(SRC, resolveSrcModule(file));
      assert.ok(fs.existsSync(full), `missing src/${file}`);
    }
  });

  it('companion extension bundle exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'companion-extension', 'manifest.json')));
    assert.ok(fs.existsSync(path.join(ROOT, 'companion-extension', 'background.js')));
    const bridge = readUtf8('src/visitors/visitor-companion-bridge.js');
    assert.ok(bridge.includes('DenizenCompanionBridge'));
    const lazy = readUtf8('src/denizen-lazy-scripts.js');
    assert.ok(lazy.includes('visitor-companion-bridge.js'));
  });

  it('index.html includes all visitor script tags', () => {
    const html = readUtf8('index.html');
    const lazy = readUtf8('src/denizen-lazy-scripts.js');
    for (const src of INDEX_EAGER_SCRIPTS) {
      const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(
        html,
        new RegExp(`<script[^>]+src="${escaped}(?:\\?[^"]*)?"`),
        `index.html missing script tag for ${src}`,
      );
    }
    for (const src of INDEX_LAZY_SCRIPTS) {
      assert.ok(
        lazy.includes(src),
        `denizen-lazy-scripts.js missing deferred load for ${src}`,
      );
    }
  });

  it('denizen-visitor.js exports required API surface', () => {
    const mod = require('../src/visitors/denizen-visitor.js');
    for (const name of REQUIRED_EXPORTS) {
      assert.equal(typeof mod[name], 'function', `denizen-visitor missing export: ${name}`);
    }
    if (typeof mod.listOrganizations === 'function') {
      assert.equal(typeof mod.listOrganizations, 'function');
    }
  });

  it('server.js contains visitor HTTP routes and WS message types', () => {
    const serverSrc = readUtf8('server.js');
    for (const marker of SERVER_ROUTE_MARKERS) {
      assert.ok(serverSrc.includes(marker), `server.js missing: ${marker}`);
    }
    const visitorSrc = readUtf8('src/visitors/denizen-visitor.js');
    assert.ok(
      visitorSrc.includes('lucy_handoff_alert'),
      'denizen-visitor.js missing lucy_handoff_alert broadcast type',
    );
  });

  it('server.js health handler exposes visitor subsystem block', () => {
    const serverSrc = readUtf8('server.js');
    assert.match(serverSrc, /visitor:\s*\{/);
    assert.match(serverSrc, /enabled:\s*true/);
    assert.match(serverSrc, /db:\s*denizenDb\.enabled/);
    assert.match(
      serverSrc,
      /features:\s*\[[^\]]*'session'[^\]]*'claim'[^\]]*'briefing'[^\]]*'commitments'[^\]]*'mcp_connector'/s,
    );
  });

  it('npc-brains.js has visitor chat hooks', () => {
    const NpcBrainManager = require('../src/npc/npc-brains.js');
    const mgr = new NpcBrainManager();
    assert.equal(typeof mgr.getPlayerResponse, 'function');
    assert.equal(typeof mgr._visitorProfilePromptBlock, 'function');
    assert.equal(typeof mgr._detectHandoffIntent, 'function');

    const src = readUtf8('src/npc/npc-brains.js');
    assert.match(src, /async getPlayerResponse\([^)]*opts\s*=\s*\{\}/);
    assert.match(src, /Boolean\(opts\.sessionId\)/);
    assert.match(src, /_visitorProfilePromptBlock\(npcName/);
    assert.match(src, /deepProfile/);
    assert.match(src, /researchContext/);
    assert.match(src, /_detectHandoffIntent\(safeMessage\)/);

    const handoff = mgr._detectHandoffIntent('please tell Lucy I need the deck reviewed');
    assert.ok(handoff && typeof handoff === 'object');
  });

  it('Node modules require() without throwing', () => {
    for (const file of NODE_MODULES) {
      assert.doesNotThrow(() => {
        require(path.join(SRC, resolveSrcModule(file)));
      }, `require src/${file} should not throw`);
    }
  });

  it('agent-bus and agent inbox are wired for team visitors', () => {
    const office = readUtf8('src/npc/agent-office-manager.js');
    assert.ok(office.includes('denizen-agent-bus'), 'agent-office-manager should dispatch denizen-agent-bus');
    const lazy = readUtf8('src/denizen-lazy-scripts.js');
    assert.ok(lazy.includes('visitor-agent-inbox.js'), 'lazy loader should include visitor-agent-inbox');
  });

  it('browser visitor modules load in Node without throwing', () => {
    for (const file of BROWSER_MODULES) {
      assert.doesNotThrow(() => {
        require(path.join(SRC, resolveSrcModule(file)));
      }, `require src/${file} should not throw`);
    }
  });
});
