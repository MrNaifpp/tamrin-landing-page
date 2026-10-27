// The organizer's registration settings, read the way the member side of the
// app reads them (RegistrationSettings.swift, EventDetailView,
// JoinSessionSheet): when registration opens, whether a seat is granted on
// sight or asked for, and whether guests may come. The server enforces every
// one of these; this only decides what the page offers, so nobody is handed
// a button the server will refuse.

import { parseDate, isPast } from './format.js'

/// When registration opens, while that is still ahead. Null once it is open,
/// and on anything that has finished or been skipped.
export function pendingOpening(event, now = Date.now()) {
  const opensAt = parseDate(event?.registration_opens_at)
  if (!opensAt || opensAt.getTime() <= now) return null
  if (event.cancelled_at || isPast(event, now)) return null
  return opensAt
}

/// Registering sends a request, and only the organizer grants the seat.
export const needsApproval = (event) => event?.approval_mode === 'manual'

export const guestsAllowed = (event) => event?.guests_allowed !== false

/// The registration sheet's guest row. Guests can be switched off, and an
/// approved exercise takes guests only alongside the member asking for them.
export const offersGuests = (event, includesSelf) =>
  guestsAllowed(event) && (!needsApproval(event) || includesSelf)

/// «سجّل معك أحد» beside a seat already held: guests added afterwards take
/// their seats at once, which an approved exercise never grants.
export const addsGuestsLater = (event) => guestsAllowed(event) && !needsApproval(event)

/// RegistrationCountdownPanel.parts — rounded up to the minute, so the last
/// minute reads 00:00:01 until the moment it opens rather than sitting on zero.
export function countdownParts(target, now = Date.now()) {
  const seconds = Math.max(0, (target - now) / 1000)
  const total = Math.ceil(seconds / 60)
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 }
}

/// get_my_registration_request: the member's own request, while it is still a
/// request. An accepted one is a seat on the roster instead.
export function requestStatus(payload) {
  const status = payload?.status
  return status === 'pending' || status === 'declined' ? status : null
}
