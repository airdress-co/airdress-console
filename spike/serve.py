#!/usr/bin/env python3
"""The spike pages with the console's production headers, for a host with no
Node (the owner's Mac). CSP verbatim from airdress-ops console.tf."""
import http.server, os, sys

CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "font-src 'self'; connect-src 'self' https:; manifest-src 'self'; base-uri 'none'; "
       "form-action 'none'; frame-ancestors 'none'")

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}
    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()
    def log_message(self, *args):
        pass

os.chdir(sys.argv[1] if len(sys.argv) > 1 else 'dist-spike')
http.server.ThreadingHTTPServer(('127.0.0.1', 47950), Handler).serve_forever()
