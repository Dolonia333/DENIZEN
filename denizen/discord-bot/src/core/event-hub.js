'use strict';

/**
 * Lightweight in-process event hub for canvas / cross-module alerts.
 */

class EventHub {
  constructor() {
    this.listeners = new Map();
    this.recent = [];
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const evt = { type, payload, ts: Date.now() };
    this.recent.push(evt);
    if (this.recent.length > 200) this.recent.shift();
    const set = this.listeners.get(type);
    if (set) {
      for (const fn of set) {
        try { fn(evt); } catch (err) {
          console.error('[event-hub]', type, err.message || err);
        }
      }
    }
    const any = this.listeners.get('*');
    if (any) {
      for (const fn of any) {
        try { fn(evt); } catch (_) {}
      }
    }
  }

  snapshot() {
    return this.recent.slice(-50);
  }
}

module.exports = { EventHub };
