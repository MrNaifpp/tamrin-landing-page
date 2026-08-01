#!/usr/bin/env python3
"""يصوّر tools/og-template.html إلى assets/og-image.png بمقاس 1200×630.

يُستخدم Chrome برأسٍ مخفي لأن القالب يعتمد على خط ثمانية سانس وخصائصه
(ss01/swsh) وعلى تشكيل النص العربي — وكلها لا تتوفّر في مكتبات الرسم.
يُصوَّر بضعف الكثافة ثم يُصغَّر، فتخرج الحواف والنص أنعم.

التشغيل (يحتاج خادمًا محليًا لأن القالب يستعمل مسارات مطلقة):
    python3 -m http.server 4173 &
    python3 tools/build-og.py
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/og-image.png"
URL = "http://localhost:4173/tools/og-template.html"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

WIDTH, HEIGHT = 1200, 630
SCALE = 2  # يُصوَّر 2400×1260 ثم يُصغَّر


def server_is_up() -> bool:
    try:
        urllib.request.urlopen(URL, timeout=3).read(1)
        return True
    except Exception:
        return False


def main() -> int:
    if not pathlib.Path(CHROME).exists():
        print(f"لم أجد Chrome في {CHROME}", file=sys.stderr)
        return 1

    if not server_is_up():
        print(
            "الخادم المحلي لا يستجيب على المنفذ 4173.\n"
            "شغّله أولًا من جذر المشروع:  python3 -m http.server 4173",
            file=sys.stderr,
        )
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        raw = pathlib.Path(tmp) / "og-raw.png"
        cmd = [
            CHROME,
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=%d" % SCALE,
            "--window-size=%d,%d" % (WIDTH, HEIGHT),
            "--screenshot=%s" % raw,
            # مهلة تكفي لتحميل الخط المضمّن قبل التصوير
            "--virtual-time-budget=6000",
            "--user-data-dir=%s" % (pathlib.Path(tmp) / "profile"),
            URL,
        ]
        subprocess.run(cmd, check=True, capture_output=True)

        if not raw.exists():
            print("لم يُنتج Chrome أي صورة", file=sys.stderr)
            return 1

        try:
            from PIL import Image
        except ImportError:
            shutil.copy(raw, OUT)
            print(f"كُتب {OUT} (بدون تصغير — Pillow غير مثبّت)")
            return 0

        im = Image.open(raw).convert("RGB")
        if im.size != (WIDTH, HEIGHT):
            im = im.resize((WIDTH, HEIGHT), Image.LANCZOS)
        im.save(OUT, "PNG", optimize=True)

    kb = OUT.stat().st_size / 1024
    print(f"كُتب {OUT}  {WIDTH}×{HEIGHT}  {kb:.0f} KB")
    print("لا تنسَ رفع رقم ?v= في وسوم og:image بالصفحات الثلاث.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
