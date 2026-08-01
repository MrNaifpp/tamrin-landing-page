#!/usr/bin/env python3
"""يولّد assets/fonts.css بتضمين خط ثمانية سانس بترميز base64.

ملفات الخط نفسها لا تُحفظ في المستودع ولا تُستضاف كملفات منفصلة — ترخيص ثمانية
يسمح بالتضمين في المواقع "كجزء من منتج مُجمَّع أو مُعبّأ أو مُعمّى" فقط.
نزّل العائلة من https://font.thmanyah.com ثم شغّل:

    python3 tools/build-fonts.py [مسار مجلد woff2]

الافتراضي هو مجلد التنزيل المعتاد على الماك.
"""

import base64
import pathlib
import sys

DEFAULT_SRC = pathlib.Path.home() / "Downloads/Thmanyah-Font-Family/thmanyah typeface/thmanyahsans/woff2"
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets/fonts.css"

# (اسم ملف الوزن، قيمة font-weight في CSS)
# نفس أوزان TamrinFontWeight في التطبيق بالضبط. لا يوجد Black: التطبيق يحوّل
# semibold/bold/heavy/black كلها إلى Bold، فإضافته هنا تخلق وزنًا لا وجود له
# في المنتج (و‍تكلّف ~78KB بلا مقابل).
WEIGHTS = [
    ("Light", "300"),
    ("Regular", "400"),
    ("Medium", "500"),
    ("Bold", "700"),
]

HEADER = """/* =========================================================================
   خط ثمانية سانس — Thmanyah Sans
   -------------------------------------------------------------------------
   Copyright © 2026 Thmanyah Publishing and Distribution (thmanyah.com).
   Reserved Font Name "thmanyah". Licensed under the Thmanyah Font License.
   Source: https://font.thmanyah.com

   الملفات مضمّنة هنا بترميز base64 كجزء من حزمة الموقع (لا تُستضاف كملفات
   خطوط منفصلة قابلة للتنزيل)، وفقًا لبند التضمين في الترخيص.
   لا تُعدّل ملفات الخط ولا يُعاد نشرها كملفات مستقلة.

   ⚠️  مُولَّد آليًا — لا تحرّره يدويًا.
       أعد توليده بـ:  python3 tools/build-fonts.py
   ========================================================================= */

"""


def main() -> int:
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.is_dir():
        print(f"لم أجد مجلد الخطوط: {src}", file=sys.stderr)
        return 1

    blocks = [HEADER]
    for name, weight in WEIGHTS:
        path = src / f"thmanyahsans-{name}.woff2"
        if not path.is_file():
            print(f"ملف ناقص: {path}", file=sys.stderr)
            return 1
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        blocks.append(
            f"/* thmanyah sans {name} — {weight} */\n"
            "@font-face {\n"
            "  font-family: 'Thmanyah Sans';\n"
            "  font-style: normal;\n"
            f"  font-weight: {weight};\n"
            "  font-display: swap;\n"
            f"  src: url(data:font/woff2;charset=utf-8;base64,{b64}) format('woff2');\n"
            "}\n"
        )

    OUT.write_text("\n".join(blocks), encoding="utf-8")
    print(f"كُتب {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
