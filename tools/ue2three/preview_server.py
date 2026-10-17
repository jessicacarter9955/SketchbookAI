"""Small loopback preview server with deterministic MIME types on Windows."""
import argparse
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.glb': 'model/gltf-binary', '.json': 'application/json'}

    def log_message(self, format, *args):
        # pythonw has no stderr stream. The default logger otherwise raises
        # before completing an HTTP response when launched without a terminal.
        if sys.stderr is not None:
            super().log_message(format, *args)

    def end_headers(self):
        # Revalidate mutable entrypoints; GLBs use content revisions in their URLs.
        if self.path.split('?', 1)[0].endswith(('.html', '.js', '.mjs', '.json')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8401)
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(args.directory.resolve()))).serve_forever()
