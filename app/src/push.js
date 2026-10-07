import { supabase } from './supabase.js'
import { DEMO } from './fixture.js'
import { VAPID_PUBLIC_KEY } from './config.js'
import { shouldOffer, switchState, base64UrlToBytes } from './push-offer.js'

/// Notifications for the web app — everything that touches the browser's push
/// APIs lives here. send-push delivers to the subscriptions saved below, beside
/// the iPhones in device_tokens.

const SW_URL = '/app/sw.js'
const SW_SCOPE = '/app/'
const LATER_KEY = 'tamrin.push.laterAt'
const OFF_KEY = 'tamrin.push.off'

function read(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch {}
}

/// Feature-detected, not sniffed: this is false in Instagram's and Snapchat's
/// in-app browsers, in incognito, and in iPhone Safari outside the home screen.
export function isSupported() {
  return !DEMO &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
}

const currentPermission = () => (isSupported() ? Notification.permission : 'default')

async function save(subscription) {
  const { endpoint, keys } = subscription.toJSON()
  const { error } = await supabase.rpc('save_web_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth
  })
  if (error) throw error
}

async function subscribe() {
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
  await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  return existing ?? registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY)
  })
}

async function existingSubscription() {
  const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE)
  return (await registration?.pushManager.getSubscription()) ?? null
}

/// Call this directly from a tap: Chrome only shows its prompt in response to
/// one, so requestPermission is the first thing that happens.
export async function enable() {
  if (!isSupported()) return false
  const answer = await Notification.requestPermission()
  if (answer !== 'granted') return false
  write(OFF_KEY, null)
  await save(await subscribe())
  return true
}

/// Turning the switch off is remembered so repair() leaves it off. Signing out
/// passes rememberOff: false, so whoever signs in next is repaired normally.
export async function disable({ rememberOff = true } = {}) {
  if (!isSupported()) return
  if (rememberOff) write(OFF_KEY, '1')
  const subscription = await existingSubscription()
  if (!subscription) return
  await supabase.rpc('delete_web_push_subscription', { p_endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}

/// Once signed in: if notifications are allowed but the subscription is gone
/// (site data cleared, a new account on this browser), put it back quietly.
/// Saving also refreshes last_seen_at and binds the browser to this account.
export async function repair() {
  if (!isSupported() || currentPermission() !== 'granted' || read(OFF_KEY) === '1') return
  await save(await subscribe())
}

export async function pushState() {
  if (!isSupported()) return 'unsupported'
  return switchState({
    supported: true,
    permission: currentPermission(),
    subscribed: Boolean(await existingSubscription())
  })
}

export function shouldOfferNow() {
  const laterAt = Number(read(LATER_KEY)) || null
  return shouldOffer({ supported: isSupported(), permission: currentPermission(), laterAt, now: Date.now() })
}

export function rememberLater() {
  write(LATER_KEY, String(Date.now()))
}
