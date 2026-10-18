import importlib.util
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
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

    def test_due_preflight_does_not_require_api_keys(self):
        self.assertFalse(app.cycle_is_due())
        app.save_setting("engine", "api")
        app.save_setting("status", "active")
        app.save_setting("next_run", "0")
        self.assertTrue(app.cycle_is_due())
        app.save_setting("next_run", str(__import__("time").time()+400))
        self.assertFalse(app.cycle_is_due())
        app.save_setting("next_run", "0")
        app.save_setting("ari_enabled", "0")
        app.save_setting("noor_enabled", "0")
        self.assertFalse(app.cycle_is_due())

    def test_recall_old_relevant_memory_and_workflow_isolation(self):
        with app.connect() as db:
            for i in range(24):
                body = ("Ari: Violet lighthouse protocol for good testing."
                        if i == 0 else "Noor: A routine note about drafts and reviews.")
                db.execute("INSERT INTO memories(ts,workflow,cycle,content) VALUES(?,?,?,?)",
                           ("2026-10-18","truthlab",i+1,body))
            db.execute("INSERT INTO memories(ts,workflow,cycle,content) VALUES(?,?,?,?)",
                       ("2026-10-18","backrooms",1,"A second workflow story."))
        text = app.recall_memories("truthlab","violet lighthouse protocol")
        self.assertIn("Violet lighthouse protocol",text)
        self.assertNotIn("second workflow story",text)
        irrelevant = app.recall_memories("truthlab","unrelated winter apples")
        self.assertNotIn("Violet lighthouse protocol",irrelevant)
        self.assertLessEqual(len(text),5400)

    def test_external_runner_requires_explicit_secure_opt_in(self):
        old_model, old_key = app.MODEL, app.API_KEY
        try:
            app.MODEL = ""
            app.API_KEY = ""
            with self.assertRaises(urllib.error.HTTPError) as err:
                self.post({"action":"start"})
            self.assertEqual(err.exception.code,400)
            self.assertEqual(app.settings()["status"],"paused")
            with patch.object(app,"external_runner_ready",return_value=True):
                self.post({"action":"start"})
                self.assertEqual(app.settings()["status"],"active")
                self.assertEqual(app.settings()["engine"],"api")
                self.assertEqual(app.settings()["next_run"],"0")
                self.assertTrue(app.get_state()["unattended_runner_ready"])
                self.post({"action":"pause"})
                self.assertEqual(app.settings()["status"],"paused")
        finally:
            app.MODEL, app.API_KEY = old_model, old_key

    def test_cycle_lease_blocks_reentry_and_can_be_released(self):
        lease = app.claim_cycle_lease()
        self.assertIsNotNone(lease)
        self.assertIsNone(app.claim_cycle_lease())
        app.release_cycle_lease(lease)
        self.assertIsNotNone(app.claim_cycle_lease())

    def test_one_shot_runner_respects_persistent_pause_and_due_time(self):
        old_model, old_key, old_reply = app.MODEL, app.API_KEY, app.ai_reply
        try:
            app.MODEL = "fixture"
            app.API_KEY = "not-a-real-key"
            app.ai_reply = lambda agent, context, cfg: agent + " proposes an evidence-based next step."
            app.scheduled_once()  # Paused by default: should do nothing.
            self.assertEqual(app.settings()["cycles"], 0)
            app.save_setting("engine", "api")
            app.save_setting("status", "active")
            app.scheduled_once()
            self.assertEqual(app.settings()["cycles"], 1)
            self.assertEqual(len(app.get_state()["messages"]), 4)
            self.assertEqual(len(app.get_state()["memories"]), 4)
            self.assertEqual(len(app.get_state()["reports"][0]["body"].split()), 50)
            app.scheduled_once()  # Not due: cannot duplicate cycle.
            self.assertEqual(app.settings()["cycles"], 1)
            app.save_setting("status", "paused")
            app.save_setting("next_run", "0")
            app.scheduled_once()  # Paused: cannot resume itself.
            self.assertEqual(app.settings()["cycles"], 1)
        finally:
            app.MODEL, app.API_KEY, app.ai_reply = old_model, old_key, old_reply

if __name__ == "__main__":
    unittest.main()
