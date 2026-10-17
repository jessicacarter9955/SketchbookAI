import sys
import tempfile
import threading
import unittest
import urllib.request
from functools import partial
from pathlib import Path
from http.server import ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview_server import Handler


class PreviewServerTests(unittest.TestCase):
    def test_pythonw_without_stderr_still_completes_http_response(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'index.html').write_text('<h1>Preview works</h1>')
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=directory))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                with patch.object(sys, 'stderr', None):
                    with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/index.html', timeout=3) as response:
                        self.assertEqual(response.status, 200)
                        self.assertIn(b'Preview works', response.read())
                        self.assertEqual(response.headers['Cache-Control'], 'no-cache')
            finally:
                server.shutdown(); thread.join(timeout=3); server.server_close()
