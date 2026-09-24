// Delivery fee, decided server-side from site/settings.delivery (edited in
// Admin → Settings → Delivery). The browser only says which method/area the
// customer picked; the fee itself is never taken from the client.
const { HttpsError } = require('firebase-functions/v2/https');

const MODES = new Set(['arranged', 'free', 'flat', 'zones']);
const money = (value) => (Number.isFinite(value) && value >= 0 && value <= 100000 ? Math.round(value * 100) / 100 : null);

/** Normalises whatever is stored (or missing) into a safe config. */
function deliveryConfig(settingsDoc) {
  const d = settingsDoc?.delivery || {};
  const zones = (Array.isArray(d.zones) ? d.zones : [])
    .map((z) => ({ name: typeof z?.name === 'string' ? z.name.trim().slice(0, 60) : '', fee: money(Number(z?.fee)) }))
    .filter((z) => z.name && z.fee !== null);
  return {
    mode: MODES.has(d.mode) ? d.mode : 'arranged',
    flatFee: money(Number(d.flatFee)) ?? 0,
    freeOver: money(Number(d.freeOver)) ?? 0,
    zones,
  };
}

/**
 * Returns { method, zone, fee, status } for the order.
 * status: 'pickup' | 'arranged' (confirmed with the customer after ordering) | 'charged' | 'free'.
 */
function resolveDelivery(settingsDoc, { preference, zone, subtotal }) {
  if (preference === 'Pickup') return { method: 'Pickup', zone: null, fee: 0, status: 'pickup' };
  const config = deliveryConfig(settingsDoc);
  if (config.mode === 'arranged') return { method: 'Delivery', zone: null, fee: 0, status: 'arranged' };
  if (config.mode === 'free') return { method: 'Delivery', zone: null, fee: 0, status: 'free' };

  let fee = config.flatFee;
  let zoneName = null;
  if (config.mode === 'zones') {
    const match = config.zones.find((z) => z.name.toLowerCase() === String(zone || '').trim().toLowerCase());
    if (!match) throw new HttpsError('invalid-argument', 'Please choose your delivery area.');
    fee = match.fee;
    zoneName = match.name;
  }
  if (config.freeOver > 0 && subtotal >= config.freeOver) return { method: 'Delivery', zone: zoneName, fee: 0, status: 'free' };
  return { method: 'Delivery', zone: zoneName, fee, status: fee > 0 ? 'charged' : 'free' };
}

module.exports = { deliveryConfig, resolveDelivery };
