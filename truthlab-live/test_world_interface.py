"""Behavioral tests for real-world side-effect boundaries; fakes are test doubles ONLY."""
import io
import json
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
import world_interface as w

class FakeR2:
    def __init__(self):
        self.data={}
    def load(self, path, default=None):
        return self.data.get(path,default)
    def save(self, path, obj):
        self.data[path]=json.loads(json.dumps(obj))
    def list_keys(self, prefix):
        return iter(p for p in self.data if p.startswith(prefix))

class FakeX:
    def __init__(self):
        self.sent=[]
    def create_post(self,text):
        self.sent.append(text)
        return {"id":"123456789","url":"https://x.com/i/web/status/123456789"}
    def get_me(self):
        return {"id":"123456"}
    def mentions(self,user_id,since_id=None):
        assert user_id=="123456"
        return [{"id":"1234567890","text":"Real-world message fetched from the X API","author_id":"123"}]

class WorldTests(unittest.TestCase):
    def test_ssrf_forbidden(self):
        for url in ["http://example.com","https://localhost/","https://127.0.0.1/",
                    "https://[::1]/","https://user:pass@example.com/",
                    "https://example.com:8080/","file:///etc/passwd","https://x.local/"]:
            with self.subTest(url=url),self.assertRaises(ValueError):
                w.public_https_url(url)
    def test_browser_html_extracts_visible_text(self):
        p=w.PlainText()
        p.feed("<body><nav>Navigation</nav><p>Hello <b>visible</b> text.</p>"
               "<script>ignore me</script><p>Second paragraph</p></body>")
        content=" ".join(" ".join(p.parts).split())
        self.assertIn("Hello visible text",content)
        self.assertIn("Second paragraph",content)
        self.assertNotIn("Navigation",content)
        self.assertNotIn("ignore me",content)
    def test_failed_closed_search(self):
        with self.assertRaises(ValueError):
            w.search_web("")
        with patch.object(w,"request_json",return_value={"query":{"search":[]}}):
            with self.assertRaisesRegex(RuntimeError,"zero"):
                w.search_web("cosmology")
    def test_wikipedia_is_labeled_not_general_search(self):
        data={"query":{"search":[{"title":"Large language model","snippet":"Actual <b>search</b> item."}]}}
        with patch.object(w,"request_json",return_value=data):
            with patch.object(w,"public_https_url",return_value="ok"):
                result=w.search_web("large language model")
        self.assertEqual(result["provider"],"wikipedia")
        self.assertIn("wikipedia.org/wiki/", result["results"][0]["url"])
    def test_research_stays_paused(self):
        with self.assertRaisesRegex(RuntimeError,"paused"):
            w.research_cycle(FakeR2())
    def test_live_research_and_two_independent_model_turns(self):
        r=FakeR2();r.save("state/control.json",{"paused":False})
        with patch.object(w,"search_web",return_value={"query":"astronomy", "searched_at":"time",
             "results":[{"title":"Stars","url":"https://example.com/stars","snippet":"Astronomy","provider":"brave"}]}):
            with patch.object(w,"read_public_page",return_value={"url":"https://example.com/stars",
                "text":"Observed real content from a test page about the formation of stars and other stellar objects.",
                "sha256":"sha", "fetched_at":"time"}):
                with patch.object(w,"completion",side_effect=["astronomy","Ari examined stars. https://example.com/stars",
                    "Noor checked the cited evidence. https://example.com/stars",
                    "AI account: a verified source on stars https://example.com/stars"]):
                    result=w.research_cycle(r)
        self.assertEqual(result["new_agent_turns"],2)
        self.assertFalse(result["published"])
        self.assertEqual(len(r.data["state/recent.json"]),2)
        self.assertTrue(r.load("drafts/"+result["draft_id"]+".json"))
    def sample_draft(self,r):
        body={"text":"AI-curated scientific thought https://example.org","research_id":"research"}
        did=w.fingerprint(body)[:24]
        r.save("drafts/"+did+".json",{"id":did, "text":body["text"],"research_id":"research",
             "sha256":w.fingerprint(body), "status":"pending_human_review"})
        return did
    def test_no_unapproved_post(self):
        r=FakeR2(); did=self.sample_draft(r); x=FakeX()
        with patch.dict(os.environ,{"TRUTHLAB_APPROVER_GITHUB_LOGIN":"jessicacarter9955"}):
            with self.assertRaises(PermissionError):
                w.approve_and_publish(r,did,"untrusted-actor",x)
        self.assertFalse(x.sent)
        self.assertFalse(r.load("approvals/"+did+".json"))
    def test_authorized_exact_draft_publish_and_retry_blocked(self):
        r=FakeR2(); did=self.sample_draft(r); x=FakeX()
        with patch.dict(os.environ,{"TRUTHLAB_APPROVER_GITHUB_LOGIN":"jessicacarter9955"}):
            posted=w.approve_and_publish(r,did,"jessicacarter9955",x)
            self.assertEqual(posted["id"],"123456789")
            self.assertEqual(len(x.sent),1)
            self.assertEqual(r.load("published/"+did+".json")["approved_by"],"jessicacarter9955")
            with self.assertRaisesRegex(RuntimeError,"Already published"):
                w.approve_and_publish(r,did,"jessicacarter9955",x)
        self.assertEqual(len(x.sent),1)
    def test_draft_mutation_is_detected(self):
        r=FakeR2(); did=self.sample_draft(r); x=FakeX()
        r.data["drafts/"+did+".json"]["text"]="MALICIOUS"
        with patch.dict(os.environ,{"TRUTHLAB_APPROVER_GITHUB_LOGIN":"jessicacarter9955"}):
            with self.assertRaisesRegex(RuntimeError,"integrity"):
                w.approve_and_publish(r,did,"jessicacarter9955",x)
        self.assertEqual(len(x.sent),0)
    def test_ambiguous_x_response_no_second_post(self):
        r=FakeR2(); did=self.sample_draft(r); x=FakeX()
        r.save("sending/"+did+".json",{"at":"time"})
        with patch.dict(os.environ,{"TRUTHLAB_APPROVER_GITHUB_LOGIN":"jessicacarter9955"}):
            with self.assertRaisesRegex(RuntimeError,"Ambiguous"):
                w.approve_and_publish(r,did,"jessicacarter9955",x)
        self.assertFalse(x.sent)
    def test_real_feedback_persists_with_cursor(self):
        r=FakeR2()
        result=w.poll_feedback(r,FakeX())
        self.assertEqual(result["real_mentions"],1)
        self.assertEqual(result["last_seen_id"],"1234567890")
        self.assertTrue(r.load("feedback/1234567890.json"))
    def test_x_does_not_fabricate_success(self):
        x=w.XClient(token="test")
        with patch.object(w,"request_json",return_value={}):
            with self.assertRaisesRegex(RuntimeError,"confirm"):
                x.create_post("Test")
    def test_r2_required(self):
        with patch.dict(os.environ,{"TRUTHLAB_R2_BUCKET":""}):
            with self.assertRaisesRegex(RuntimeError,"required"):
                w.R2Journal()

if __name__=="__main__":
    unittest.main()
