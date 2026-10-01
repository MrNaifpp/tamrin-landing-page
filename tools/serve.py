#!/usr/bin/env python3
"""Serves the site locally with the same rewrites netlify.toml applies.

`python3 -m http.server` is enough for the landing page, but /event/<id>,
/join/<code> and /app/<screen> are web-app routes, not files, and it answers
them with a 404. This adds those rules (plus /admin) so local behaviour
matches production.

    python3 tools/serve.py [port]

Then http://localhost:4173/app/?demo=1 runs the member web app against its
local fixture — no Supabase project, no email, no writes to a real group.
"""

import http.server
import os
import socketserver
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173

# Same order and meaning as the [[redirects]] in netlify.toml: a rewrite only
# applies when no file matches the path.
REWRITES = [
    ("/admin", "/admin.html", True),
    ("/event/", "/app/index.html", False),
    ("/join/", "/app/index.html", False),
    ("/app/", "/app/index.html", False),
]


class SiteHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        resolved = super().translate_path(path)
        if os.path.isfile(resolved):
            return resolved
        route = path.split("?", 1)[0].split("#", 1)[0]
        for prefix, target, exact in REWRITES:
            if (route == prefix) if exact else route.startswith(prefix):
                return super().translate_path(target)
        return resolved

    def end_headers(self):
        # Editing a file and reloading should show the edit.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), SiteHandler) as httpd:
    print(f"تمرين على http://localhost:{PORT}  (تطبيق الويب: /app/?demo=1)")
    httpd.serve_forever()
