"""Tests ensure the multi-network worker NEVER falsely reports real posts.

Network responses below are test doubles: production always calls official endpoints.
"""
import json
import os
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,os.path.dirname(__file__))
import social_hub as sh

class Ledger:
    def __init__(self):
        self.objects={}
    def save(self,key,value):
        self.objects[key]=json.loads(json.dumps(value))
    def load(self,key,default=None):
        return self.objects.get(key,default)

class HubTests(unittest.TestCase):
    def sample(self,network="threads",content=None):
        r=Ledger()
        content=content or {"text":"Ari and Noor verified a source https://example.com"}
        key=sh.queue_draft(r,network,content,"research-123")
        return r,key
    def test_all_eight_channels_declared(self):
        self.assertEqual(set(sh.NETWORKS),{"x","threads","facebook","instagram",
                                         "tiktok","youtube","reddit","snapchat"})
    def test_unknown_network_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"Unknown"):
            sh.queue_draft(Ledger(),"myspace",{"text":"hello"},"research")
    def test_no_operator_no_publication(self):
        r,key=self.sample()
        with patch.dict(os.environ,{"TRUTHLAB_APPROVER_GITHUB_LOGIN":"jessicacarter9955"}):
            with patch.object(sh,"platform_publish") as publisher:
                with self.assertRaises(PermissionError):
                    sh.publish_approved(r,key,"threads","random-bot")
                publisher.assert_not_called()
    def test_immutable_network_bound(self):
        r,key=self.sample()
        with patch.dict(os.environ,{"TRUTHLAB_APPROVER_GITHUB_LOGIN":"jessicacarter9955"}):
            with self.assertRaisesRegex(ValueError,"unreviewed"):
                sh.publish_approved(r,key,"facebook","jessicacarter9955")
            r.objects["social/drafts/"+key+".json"]["content"]["text"]="Changed by someone"
            with self.assertRaisesRegex(RuntimeError,"modified"):
                sh.publish_approved(r,key,"threads","jessicacarter9955")
    def test_real_api_confirmation_is_required(self):
        r,key=self.sample()
        with patch.dict(os.environ,{"TRUTHLAB_APPROVER_GITHUB_LOGIN":"jessicacarter9955"}):
            with patch.object(sh,"platform_publish",return_value={"status":"published","id":"real"}):
                response=sh.publish_approved(r,key,"threads","jessicacarter9955")
            self.assertEqual(response["status"],"published")
            self.assertTrue(r.load("social/threads/"+key+"/published.json"))
            with self.assertRaisesRegex(RuntimeError,"Already sent"):
                sh.publish_approved(r,key,"threads","jessicacarter9955")
    def test_failed_api_not_falsely_published_and_no_duplicate(self):
        r,key=self.sample("facebook")
        with patch.dict(os.environ,{"TRUTHLAB_APPROVER_GITHUB_LOGIN":"jessicacarter9955"}):
            with patch.object(sh,"platform_publish",side_effect=RuntimeError("Facebook HTTP 403")):
                with self.assertRaisesRegex(RuntimeError,"403"):
                    sh.publish_approved(r,key,"facebook","jessicacarter9955")
            self.assertIsNone(r.load("social/facebook/"+key+"/published.json"))
            self.assertIsNotNone(r.load("social/facebook/"+key+"/sending.json"))
            with self.assertRaisesRegex(RuntimeError,"ambiguous"):
                sh.publish_approved(r,key,"facebook","jessicacarter9955")
    def test_threads_two_real_api_steps(self):
        content={"text":"Real text"}
        with patch.dict(os.environ,{"TRUTHLAB_THREADS_USER_ID":"1234567",
                                    "TRUTHLAB_THREADS_ACCESS_TOKEN":"private",
                                    "TRUTHLAB_THREADS_USERNAME":"truthlab"}):
            with patch.object(sh,"form_json",side_effect=[{"id":"container7"},{"id":"post9"}]) as api:
                result=sh.threads_post(content)
        self.assertEqual(result["id"],"post9")
        self.assertEqual(api.call_count,2)
        self.assertIn("threads_publish",api.call_args_list[1].args[0])
    def test_facebook_requires_actual_confirmed_id(self):
        with patch.dict(os.environ,{"TRUTHLAB_FB_PAGE_ID":"12345","TRUTHLAB_FB_PAGE_TOKEN":"secret"}):
            with patch.object(sh,"form_json",return_value={}):
                with self.assertRaisesRegex(ValueError,"id"):
                    sh.facebook_post({"text":"hello"})
    def test_instagram_denies_text_only(self):
        with patch.dict(os.environ,{"TRUTHLAB_IG_USER_ID":"12345","TRUTHLAB_IG_ACCESS_TOKEN":"test"}):
            with self.assertRaisesRegex(ValueError,"image/video"):
                sh.instagram_post({"text":"Only text","media_type":"text","media_url":"https://example.com/photo.jpg"})
    def test_tiktok_processing_is_not_published(self):
        content={"text":"photo","media_type":"image","media_url":"https://example.com/photo.jpg",
                 "privacy_level":"SELF_ONLY"}
        with patch.dict(os.environ,{"TRUTHLAB_TIKTOK_USER_TOKEN":"private"}):
            with patch.object(sh,"public_https_url",return_value=content["media_url"]):
                with patch.object(sh,"social_request",side_effect=[
                      {"error":{"code":"ok"},"data":{"privacy_level_options":["SELF_ONLY"]}},
                      {"error":{"code":"ok"},"data":{"publish_id":"p_pub_real"}}]):
                    result=sh.tiktok_post(content)
        self.assertEqual(result["status"],"processing")
        self.assertFalse(result["public_post_verified"])
    def test_tiktok_requires_actual_final_status(self):
        with patch.dict(os.environ,{"TRUTHLAB_TIKTOK_USER_TOKEN":"private"}):
            with patch.object(sh,"social_request",return_value={
                "error":{"code":"ok"},"data":{"status":"PROCESSING_DOWNLOAD","publicaly_available_post_id":[]}}):
                self.assertEqual(sh.tiktok_check("real_pub")["status"],"processing")
    def test_youtube_requires_real_media(self):
        with self.assertRaisesRegex(ValueError,"video"):
            sh.youtube_post({"media_type":"text","text":"not a video"},Ledger())
    def test_snapchat_requires_allowlisted_profile_and_real_media(self):
        with patch.dict(os.environ,{"TRUTHLAB_SNAP_PUBLIC_PROFILE_ID":"",
                                    "TRUTHLAB_SNAP_USER_TOKEN":""}):
            with self.assertRaisesRegex(RuntimeError,"TRUTHLAB_SNAP_PUBLIC_PROFILE_ID"):
                sh.snapchat_post({"media_type":"spotlight","media_id":"media_real123"})
    def test_reddit_subreddit_is_approved_target(self):
        with self.assertRaisesRegex(ValueError,"subreddit"):
            sh.reddit_post({"text":"body","title":"title","subreddit":"r/unknown"})
    def test_reddit_submits_real_self_post_with_oauth(self):
        payload={"text":"real excerpt","title":"Research","subreddit":"science"}
        with patch.dict(os.environ,{"TRUTHLAB_REDDIT_USER_TOKEN":"private","TRUTHLAB_REDDIT_USERNAME":"truthlabtest"}):
            with patch.object(sh,"form_json",return_value={"json":{"errors":[],"data":{
                 "name":"t3_2345","url":"https://reddit.com/r/science/comments/2345"}}}) as req:
                result=sh.reddit_post(payload)
        self.assertEqual(result["id"],"t3_2345")
        self.assertEqual(req.call_args.args[0],"https://oauth.reddit.com/api/submit")
        self.assertIn("by /u/truthlabtest",req.call_args.kwargs["user_agent"])

if __name__=="__main__":
    unittest.main()
