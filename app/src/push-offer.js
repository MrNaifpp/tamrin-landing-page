/// The decisions behind notifications, kept free of browser APIs so
/// tests/push-offer.test.html can check them directly.

/// «لاحقاً» on the prompt holds it back this long.
export const LATER_DAYS = 14

/// Whether to show «تبي ننبهك؟» after a registration. Only an undecided
/// browser is asked: once someone allows or blocks, Chrome will not show its
/// prompt again, so asking would only frustrate them.
export function shouldOffer({ supported, permission, laterAt, now }) {
  if (!supported || permission !== 'default') return false
  if (!laterAt) return true
  return now - laterAt >= LATER_DAYS * 86400000
}

/// What the Settings switch shows.
export function switchState({ supported, permission, subscribed }) {
  if (!supported) return 'unsupported'
  if (permission === 'denied') return 'blocked'
  return permission === 'granted' && subscribed ? 'on' : 'off'
}

/// The VAPID public key travels as unpadded base64url; pushManager.subscribe
/// wants the raw bytes.
export function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}
