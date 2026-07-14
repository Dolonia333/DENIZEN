'use strict';

/**
 * Console migration / activity logs for Discord room tracker.
 */

function channelLabel(room) {
  if (!room) return '(unknown)';
  const name = room.name || room.id || '?';
  if (room.type === 'voice' || room.type === 'stage') return name;
  return `#${name}`;
}

function join({ displayName, toRoom, count }) {
  console.log(`[Join] ${displayName} entered ${channelLabel(toRoom)}. New Room Count: ${count}`);
}

function leave({ displayName, fromRoom, count }) {
  console.log(`[Leave] ${displayName} left ${channelLabel(fromRoom)}. New Room Count: ${count}`);
}

function move({ displayName, fromRoom, toRoom, count }) {
  console.log(
    `[Move] ${displayName} walked from ${channelLabel(fromRoom)} to ${channelLabel(toRoom)}. New Room Count: ${count}`,
  );
}

function text({ displayName, room, count }) {
  console.log(`[Text] ${displayName} active in ${channelLabel(room)} (${count} online)`);
}

function expire({ displayName, room, count }) {
  console.log(`[Expire] ${displayName} left soft presence in ${channelLabel(room)}. New Room Count: ${count}`);
}

module.exports = {
  channelLabel,
  join,
  leave,
  move,
  text,
  expire,
};
