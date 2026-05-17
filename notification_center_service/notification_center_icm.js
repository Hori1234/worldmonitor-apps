/**
 * notification_center_icm.js
 * Internal Communication Message (ICM) bus.
 * Every accepted ingest call produces exactly one ICM.
 * The Edge Rule Engine and WebSocket broadcaster subscribe here.
 */

import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(200);

/**
 * Emit an ICM on the bus.
 * Fires both on the specific icmType channel AND on the wildcard '*' channel.
 * @param {object} icm  ICM payload object (must contain icmType)
 */
export function emitICM(icm) {
  bus.emit(icm.icmType, icm);
  bus.emit('*', icm);
}

/**
 * Subscribe to a specific ICM type or '*' for all.
 * @param {string}   type     e.g. 'icm:market-update' or '*'
 * @param {Function} handler  (icm) => void
 */
export function onICM(type, handler) {
  bus.on(type, handler);
}

/**
 * Unsubscribe.
 */
export function offICM(type, handler) {
  bus.off(type, handler);
}
