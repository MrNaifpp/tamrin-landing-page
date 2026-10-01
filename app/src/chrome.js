import { useEffect } from '../vendor/preact.js'
import { averageArtColor } from './ui.js'

/// The browser's own bars — Safari's status bar and toolbar, Android Chrome's
/// toolbar — sit outside the page and cannot show the artwork behind them.
/// Safari paints them with the page's background colour and Chrome with
/// theme-color, so each screen hands over the colour its edges actually are,
/// and the bars read as part of the screen instead of two black bands.
///
/// Safari only does this while no full-bleed fixed layer sits on the screen's
/// edge: given one, it reads that layer's background once, as the page loads,
/// and never again — which is why the event page's artwork is sticky.
///
/// `source` is either a selector, whose element's computed background is used
/// (so a screen's dark-mode colour comes along for free), or `{ art, dim }`:
/// a picture's average colour under the same black veil the screen lays over
/// it — `dim` is how much of the picture's light survives the veil.
export function useBarColor(source) {
  const key = typeof source === 'string' ? source : `${source.art}|${source.dim}`
  useEffect(() => {
    let live = true
    if (typeof source === 'string') {
      const element = document.querySelector(source)
      if (element) paint(getComputedStyle(element).backgroundColor)
    } else {
      averageArtColor(source.art)
        .then(([r, g, b]) => {
          if (live) paint(`rgb(${[r, g, b].map((c) => Math.round(c * source.dim)).join(', ')})`)
        })
        .catch(() => {})
    }
    return () => { live = false }
  }, [key])
}

function paint(color) {
  document.documentElement.style.backgroundColor = color
  document.body.style.backgroundColor = color
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', color)
}
