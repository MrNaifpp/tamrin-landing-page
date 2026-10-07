// تمرين's service worker. It exists only for notifications: no fetch handler,
// no caching, so the site behaves exactly as it does without it.
//
// Served from /app/sw.js with scope /app/. Pushes reach it whatever page is
// open, and a tap opens /event/<id>, which the site already routes.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  event.waitUntil(
    self.registration.showNotification(data.title || 'تمرين', {
      body: data.body || '',
      dir: 'rtl',
      lang: 'ar',
      icon: '/assets/favicon.png',
      data: { eventId: data.event_id || null }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const eventId = event.notification.data && event.notification.data.eventId
  const target = new URL(eventId ? `/event/${encodeURIComponent(eventId)}` : '/app/', self.location.origin).href
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = tabs.find((tab) => tab.url === target)
    if (open) return open.focus()
    return self.clients.openWindow(target)
  })())
})
