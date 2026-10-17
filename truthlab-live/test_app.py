import importlib.util
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location("truthlab_live_app", Path(__file__).parent / "app.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

class TruthLabTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        app.DB = str(Path(self.tmp.name) / "test.sqlite")
        app.TOKEN = "fixture-long-test-token-really-private"
        app.initialize()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:%d" % self.httpd.server_port

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.tmp.cleanup()

    def post(self, payload, token=True):
        headers = {"Content-Type":"application/json"}
        if token: headers["Authorization"] = "Bearer " + app.TOKEN
        req=urllib.request.Request(self.url + "/api/control", json.dumps(payload).encode(), headers, method="POST")
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.loads(r.read())

    def test_agents_start_enabled(self):
        s=app.settings()
        self.assertEqual(s["agents_enabled"], {"Ari":True,"Noor":True})
        self.assertEqual(s["status"], "paused")

    def test_individual_pause_does_not_affect_partner(self):
        self.post({"action":"set_agent","agent":"Ari","enabled":False})
        self.assertEqual(app.settings()["agents_enabled"], {"Ari":False,"Noor":True})
        self.post({"action":"set_agent","agent":"Noor","enabled":False})
        self.assertEqual(app.settings()["agents_enabled"], {"Ari":False,"Noor":False})
        self.post({"action":"set_agent","agent":"Ari","enabled":True})
        self.assertEqual(app.settings()["agents_enabled"], {"Ari":True,"Noor":False})

    def test_unauthorized_write(self):
        with self.assertRaises(urllib.error.HTTPError) as r:
            self.post({"action":"pause"},token=False)
        self.assertEqual(r.exception.code,401)

    def test_browser_start_and_stop(self):
        self.post({"action":"browser_start"})
        self.assertEqual(app.settings()["status"], "active")
        self.assertEqual(app.settings()["engine"], "browser")
        self.post({"action":"browser_ping"})
        self.assertTrue(app.get_state()["browser_active"])
        self.post({"action":"pause"})
        self.assertEqual(app.settings()["status"], "paused")
        self.assertEqual(app.settings()["engine"], "idle")

    def test_operator_message_recorded(self):
        self.post({"action":"message","target":"Noor","text":"Check this idea."})
        self.assertEqual(app.get_state()["messages"][-1]["speaker"],"Operator")
        self.assertIn("[For Noor]",app.get_state()["messages"][-1]["body"])

    def test_paused_agent_cannot_emit(self):
        self.post({"action":"set_agent","agent":"Noor","enabled":False})
        with self.assertRaises(urllib.error.HTTPError) as r:
            self.post({"action":"browser_message","speaker":"Noor","text":"fake"})
        self.assertEqual(r.exception.code,400)

    def test_browser_report_exactly_fifty_words(self):
        self.post({"action":"browser_start"})
        self.post({"action":"browser_message","speaker":"Ari","text":"A proposed project with a measurable market test."})
        self.post({"action":"browser_report"})
        s=app.get_state()
        self.assertEqual(s["cycles"],1) if "cycles" in s else self.assertEqual(s["config"]["cycles"],1)
        self.assertEqual(len(s["reports"][0]["body"].split()),50)
        self.assertEqual(s["reports"][0]["mode"],"browser-qwen-unverified")

if __name__ == "__main__":
    unittest.main()
