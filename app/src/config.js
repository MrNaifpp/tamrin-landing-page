// Which Supabase project the web client talks to.
//
// Production, the same project the App Store build reaches through
// Config/Release.xcconfig in the iOS repo. It has to be: the /event/<id> and
// /join/<code> links that build shares carry production ids, so a web member
// on any other project would open a friend's link and find nothing. The
// تمرين STG build (com.businessech.tmrin.staging) stays on the sandbox and
// has no web counterpart.
//
// The anon key is public by design: it ships in the iOS binary and in the
// admin dashboard already, and RLS plus the SECURITY DEFINER RPCs are what
// actually protect the data. Never put a service_role key here.
export const SUPABASE_HOST = 'hzsxwnmbdkrmipjtfzlp.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6c3h3bm1iZGtybWlwanRmemxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NTcwOTksImV4cCI6MjEwMTIzMzA5OX0.Opjcn6HMOWdw07RPDEXGaytKziAsnvvJSzpzuw8NiPY'

export const SUPABASE_URL = `https://${SUPABASE_HOST}`

/// Where the iOS build lives, for the «حمّل التطبيق» affordances that stand in
/// for the organizer tools the web version deliberately does not carry.
export const APP_STORE_URL = 'https://apps.apple.com/sa/app/id6757168784'

/// Web Push: the public half of the VAPID key pair whose private half is the
/// VAPID_KEYS secret on both Supabase projects. Public by design — every
/// browser that subscribes receives it.
export const VAPID_PUBLIC_KEY = 'BNbzpqdHDBDGhqaScb_Mb67xWFdl2iH7IpQLez9ajIezwrBAicuQGgItNfcr8EF9ZUXif1cXtdUbDtFFYM1gFqQ'
