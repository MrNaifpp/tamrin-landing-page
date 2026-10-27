import { html, useState, useEffect } from '../../vendor/preact.js'
import { arabicDay, arabicTime } from '../format.js'
import { countdownParts } from '../registration-rules.js'

/// RegistrationCountdownPanel: stands where the list will be until
/// registration opens — the time left, large, and the moment it ends. The
/// organizer's «افتح التسجيل الآن» stays in the app.
export function RegistrationCountdownPanel({ opensAt, onOpened }) {
  const [now, setNow] = useState(Date.now)
  const target = opensAt.getTime()

  useEffect(() => {
    const timer = setInterval(() => {
      const tick = Date.now()
      setNow(tick)
      if (tick >= target) {
        clearInterval(timer)
        onOpened?.()
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [target])

  const parts = countdownParts(target, now)
  const unit = (value, label) => html`
    <div class="countdown-unit">
      <span class="countdown-value change" key=${value}>${String(value).padStart(2, '0')}</span>
      <span class="countdown-label">${label}</span>
    </div>
  `
  const separator = html`<span class="countdown-separator">:</span>`

  return html`
    <div class="countdown enter" style="--i:4">
      <div class="countdown-title">يفتح التسجيل بعد</div>
      <div class="countdown-units" role="timer"
           aria-label=${`يفتح التسجيل بعد ${parts.days} يوم و${parts.hours} ساعة و${parts.minutes} دقيقة`}>
        ${unit(parts.days, 'يوم')}
        ${separator}
        ${unit(parts.hours, 'ساعة')}
        ${separator}
        ${unit(parts.minutes, 'دقيقة')}
      </div>
      <div class="countdown-when">يوم ${arabicDay(opensAt)}، الساعة ${arabicTime(opensAt)}</div>
    </div>
  `
}
