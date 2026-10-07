import { html, useState } from '../../vendor/preact.js'
import { Sheet } from '../ui.js'
import { useDismissible } from '../motion.js'
import { enable, rememberLater } from '../push.js'

/// Shown once a registration succeeds — the moment reminders and payment
/// notices obviously matter. The browser's own prompt follows the tap on
/// «فعّل التنبيهات»; closing the sheet any other way counts as «لاحقاً».
export function NotifySheet({ onClose, onEnabled, onFailed }) {
  const { closing, dismiss } = useDismissible(null)
  const [busy, setBusy] = useState(false)

  async function turnOn() {
    setBusy(true)
    try {
      const granted = await enable()
      dismiss(() => { onClose(); if (granted) onEnabled() })
    } catch {
      dismiss(() => { onClose(); onFailed('تعذر تفعيل التنبيهات. جرّب من الإعدادات.') })
    }
  }

  const later = () => { rememberLater(); onClose() }

  return html`
    <${Sheet} title="تبي ننبهك؟" onClose=${later} closing=${closing}>
      <div class="vstack" style="gap:14px">
        <p class="confirm-message">نذكّرك قبل التمرين، ونبلغك بالدفع وبكل جديد في مجموعتك.</p>
        <button class="action action-prominent" disabled=${busy} onClick=${turnOn}>فعّل التنبيهات</button>
        <button class="action action-glass" disabled=${busy} onClick=${() => dismiss(later)}>لاحقاً</button>
      </div>
    <//>
  `
}
