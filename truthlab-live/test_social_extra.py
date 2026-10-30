"""Provider-contract checks for three real official social connectors.

Network calls are replaced by test doubles only in CI, never in production.
"""
import os
import sys
import unittest
from unittest.mock import patch, MagicMock
sys.path.insert(0,os.path.dirname(__file__))
import social_extra as se

class ExtraNetworks(unittest.TestCase):
    def test_bluesky_must_receive_actual_atproto_record_uri(self):
        session={"did":"did:plc:actual","handle":"truthlab.bsky.social","accessJwt":"token"}
        with patch.dict(os.environ,{"TRUTHLAB_BSKY_IDENTIFIER":"truthlab.bsky.social",
                                     "TRUTHLAB_BSKY_APP_PASSWORD":"app_password"}):
            with patch.object(se,"request_json",side_effect=[
                session,{"uri":"at://did:plc:actual/app.bsky.feed.post/abc123"}]) as req:
                result=se.bluesky_post({"text":"An original social thought"})
        self.assertEqual(result["status"],"published")
        self.assertIn("truthlab.bsky.social/post/abc123",result["url"])
        self.assertEqual(req.call_count,2)
        with patch.dict(os.environ,{"TRUTHLAB_BSKY_IDENTIFIER":"truthlab.bsky.social",
                                     "TRUTHLAB_BSKY_APP_PASSWORD":"app_password"}):
            with patch.object(se,"request_json",side_effect=[session,{}]):
                with self.assertRaisesRegex(RuntimeError,"verified post"):
                    se.bluesky_post({"text":"An original social thought"})
    def test_linkedin_only_reports_post_from_201_plus_urn(self):
        mock=MagicMock()
        mock.status=201
        mock.headers={"x-restli-id":"urn:li:share:78901"}
        mock.__enter__.return_value=mock
        mock.__exit__.return_value=False
        with patch.dict(os.environ,{"TRUTHLAB_LINKEDIN_AUTHOR_URN":"urn:li:organization:123456",
                                     "TRUTHLAB_LINKEDIN_ACCESS_TOKEN":"user_oauth"}):
            with patch.object(se,"urlopen",return_value=mock) as send:
                result=se.linkedin_post({"text":"Agent-authored but human-approved finding"})
        self.assertEqual(result["id"],"urn:li:share:78901")
        self.assertIn("Linkedin-version",dict(send.call_args.args[0].header_items()))
    def test_pinterest_requires_image_and_actual_receipt(self):
        with patch.dict(os.environ,{"TRUTHLAB_PINTEREST_ACCESS_TOKEN":"token"}):
            with self.assertRaisesRegex(ValueError,"board"):
                se.pinterest_post({"text":"no image"})
            with patch.object(se,"public_https_url",return_value="https://example.com/img.png"):
                with patch.object(se,"request_json",return_value={"id":"123456789"}) as call:
                    published=se.pinterest_post({"media_type":"image","media_url":"https://example.com/img.png",
                       "board_id":"222","text":"Insight with picture","title":"Original artwork"})
        self.assertEqual(published["status"],"published")
        self.assertEqual(call.call_args.kwargs["payload"]["media_source"]["source_type"],"image_url")
    def test_no_fabricated_receipt(self):
        with patch.dict(os.environ,{"TRUTHLAB_PINTEREST_ACCESS_TOKEN":"token"}):
            with patch.object(se,"public_https_url",return_value=True):
                with patch.object(se,"request_json",return_value={}):
                    with self.assertRaisesRegex(RuntimeError,"confirm"):
                        se.pinterest_post({"media_type":"image","media_url":"https://example.com/a.jpg",
                                           "board_id":"222", "text":"Verified claim"})
if __name__=="__main__":
    unittest.main()
