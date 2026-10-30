"""Official multi-network publishing for TruthLab.

Every external write requires an individually approved, immutable R2 draft.
Requests are real API calls; missing credentials, media or platform approval fail closed.
A "request accepted" response is NOT falsely reported as a public post.
"""
import hashlib
import json
import os
import re
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from world_interface import R2Journal, XClient, fingerprint, public_https_url, request_json, timestamp

NETWORKS = ("x", "threads", "facebook", "instagram", "tiktok",
            "youtube", "reddit", "snapchat")

def mandatory(name):
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError("Missing account integration: " + name)
    return value

def token(name):
    return "Bearer " + mandatory(name)

def required_field(obj, name):
    val = obj.get(name)
    if not isinstance(val, str) or not val.strip():
        raise ValueError("Missing required field: "+name)
    return val.strip()

def form_json(url, fields, access_token, user_agent="TruthLabSocial/1.0"):
    public_https_url(url)
    req = Request(url, urlencode(fields).encode("utf-8"),
                  {"Authorization":"Bearer "+access_token, "Content-Type":"application/x-www-form-urlencoded",
                   "User-Agent":user_agent}, method="POST")
    try:
        with urlopen(req, timeout=35) as result:
            return json.loads(result.read(500000))
    except HTTPError as exc:
        raise RuntimeError("Social API HTTP "+str(exc.code)+" at "+(url.split("/")[2])) from None

def social_request(url, bearer, payload=None, method="GET"):
    return request_json(url, "Bearer "+bearer, method=method, payload=payload)

def facebook_post(draft):
    page_id = mandatory("TRUTHLAB_FB_PAGE_ID")
    if not re.fullmatch(r"\d+", page_id):
        raise ValueError("Invalid Facebook Page identifier")
    text = required_field(draft,"text")
    result = form_json("https://graph.facebook.com/v25.0/"+page_id+"/feed",
                       {"message":text}, mandatory("TRUTHLAB_FB_PAGE_TOKEN"))
    post_id = required_field(result,"id")
    return {"status":"published","id":post_id, "url":"https://www.facebook.com/"+post_id,
            "provider":"facebook-pages"}

def threads_post(draft):
    user_id = mandatory("TRUTHLAB_THREADS_USER_ID")
    if not re.fullmatch(r"\d+",user_id):
        raise ValueError("Invalid Threads user identifier")
    text = required_field(draft,"text")
    bearer = mandatory("TRUTHLAB_THREADS_ACCESS_TOKEN")
    base = "https://graph.threads.net/v1.0/"+user_id
    first = form_json(base+"/threads",{"media_type":"TEXT","text":text},bearer)
    creation_id = required_field(first,"id")
    response = form_json(base+"/threads_publish",{"creation_id":creation_id},bearer)
    post_id = required_field(response,"id")
    return {"status":"published","id":post_id,
            "url":"https://www.threads.net/@"+mandatory("TRUTHLAB_THREADS_USERNAME")+"/post/"+post_id,
            "provider":"threads"}

def instagram_post(draft):
    user_id=mandatory("TRUTHLAB_IG_USER_ID")
    if not re.fullmatch(r"\d+", user_id):
        raise ValueError("Invalid Instagram professional account ID")
    token_value=mandatory("TRUTHLAB_IG_ACCESS_TOKEN")
    media_type=required_field(draft,"media_type").lower()
    media_url=public_https_url(required_field(draft,"media_url"))
    params={"caption":draft.get("text","")}
    if media_type=="image":
        params["image_url"]=media_url
    elif media_type=="video":
        params.update({"media_type":"REELS","video_url":media_url,"share_to_feed":"true"})
    else:
        raise ValueError("Instagram publishing requires a real image/video (no text-only posts)")
    base="https://graph.facebook.com/v25.0/"
    created=form_json(base+user_id+"/media",params,token_value)
    creation_id=required_field(created,"id")
    if media_type=="video":
        for i in range(12):
            state=request_json(base+creation_id+"?fields=status_code", "Bearer "+token_value)
            status=state.get("status_code")
            if status=="FINISHED":
                break
            if status in ("ERROR","EXPIRED"):
                raise RuntimeError("Instagram video processing failed: "+str(status))
            time.sleep(5)
        else:
            raise RuntimeError("Instagram video processing unconfirmed; publishing not attempted")
    published=form_json(base+user_id+"/media_publish",{"creation_id":creation_id},token_value)
    post_id=required_field(published,"id")
    return {"status":"published","id":post_id,"provider":"instagram-professional"}

def reddit_post(draft):
    sub=required_field(draft,"subreddit")
    if not re.fullmatch(r"[A-Za-z0-9_]{2,21}",sub):
        raise ValueError("Invalid specific approved subreddit")
    title=required_field(draft,"title")
    body=required_field(draft,"text")
    if len(title)>300:
        raise ValueError("Reddit post title exceeds 300 characters")
    reddit_user=mandatory("TRUTHLAB_REDDIT_USERNAME")
    if not re.fullmatch(r"[A-Za-z0-9_-]{3,20}",reddit_user):
        raise ValueError("Invalid Reddit app-account username")
    result=form_json("https://oauth.reddit.com/api/submit",
                     {"api_type":"json","kind":"self","sr":sub,"title":title,"text":body,
                      "sendreplies":"false"},mandatory("TRUTHLAB_REDDIT_USER_TOKEN"),
                      user_agent="script:truthlab-autonomous:v1.0 (by /u/"+reddit_user+")")
    reply=result.get("json",{})
    if reply.get("errors"):
        raise RuntimeError("Reddit submission rejected: "+str(reply["errors"][:3]))
    data=reply.get("data") or {}
    post_id=data.get("name") or data.get("id")
    url=data.get("url")
    if not isinstance(post_id,str) or not post_id:
        raise RuntimeError("Reddit has not confirmed a submission ID")
    return {"status":"published","id":post_id,"url":url,
            "provider":"reddit-oauth","subreddit":sub}

def tiktok_post(draft):
    bearer=mandatory("TRUTHLAB_TIKTOK_USER_TOKEN")
    mode=required_field(draft,"media_type").lower()
    media=public_https_url(required_field(draft,"media_url"))
    data=social_request("https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
                        bearer,payload={},method="POST")
    if data.get("error",{}).get("code")!="ok":
        raise RuntimeError("TikTok creator verification failed")
    creator=data.get("data",{})
    privacy=required_field(draft,"privacy_level")
    if privacy not in creator.get("privacy_level_options",[]):
        raise ValueError("TikTok privacy must match authorized creator options")
    post_info={"privacy_level":privacy,"disable_comment":False}
    description=draft.get("text","")
    if mode=="image":
        payload={"post_mode":"DIRECT_POST","media_type":"PHOTO",
                 "post_info":{**post_info,"title":draft.get("title","")[:90],
                              "description":description[:4000]},
                 "source_info":{"source":"PULL_FROM_URL","photo_cover_index":1,
                                "photo_images":[media]}}
        endpoint="content/init/"
    elif mode=="video":
        payload={"post_info":{**post_info,"title":description[:2200],
                             "disable_duet":False,"disable_stitch":False},
                 "source_info":{"source":"PULL_FROM_URL","video_url":media}}
        endpoint="video/init/"
    else:
        raise ValueError("TikTok requires real video or real image, not text-only")
    res=social_request("https://open.tiktokapis.com/v2/post/publish/"+endpoint,
                       bearer,payload=payload,method="POST")
    if res.get("error",{}).get("code")!="ok":
        raise RuntimeError("TikTok rejected publication initialization")
    publish_id=required_field(res.get("data",{}),"publish_id")
    # TikTok gives a publish_id before moderation, not a post URL.
    return {"status":"processing","id":publish_id,"provider":"tiktok",
            "public_post_verified":False}

def tiktok_check(publish_id):
    bearer=mandatory("TRUTHLAB_TIKTOK_USER_TOKEN")
    reply=social_request("https://open.tiktokapis.com/v2/post/publish/status/fetch/",
                         bearer,payload={"publish_id":publish_id},method="POST")
    if reply.get("error",{}).get("code")!="ok":
        raise RuntimeError("TikTok status API error")
    status=reply.get("data",{}).get("status")
    if status=="FAILED":
        raise RuntimeError("TikTok publishing FAILED: "+str(reply.get("data",{}).get("fail_reason","")))
    ids=reply.get("data",{}).get("publicaly_available_post_id",[])
    return {"status":"published" if status=="PUBLISH_COMPLETE" else "processing",
            "public_post_verified":bool(ids),"id":publish_id,
            "post_ids":[str(x) for x in ids],"provider":"tiktok"}

def youtube_post(draft, ledger):
    if required_field(draft,"media_type").lower()!="video":
        raise ValueError("YouTube only accepts an actual video file")
    title=required_field(draft,"title")
    if len(title)>100:
        raise ValueError("YouTube title too long")
    key=required_field(draft,"media_key")
    if not re.fullmatch(r"media/[A-Za-z0-9._/-]{1,150}\.(mp4|webm|mov)",key) or ".." in key:
        raise ValueError("YouTube video must be in approved private R2 media/ prefix")
    access=mandatory("TRUTHLAB_YOUTUBE_ACCESS_TOKEN")
    import requests
    with tempfile.TemporaryDirectory(prefix="truthlab-video-") as temp:
        name=Path(temp)/"video"
        ledger.client.download_file(ledger.bucket, ledger.ROOT+key if hasattr(ledger,"ROOT") else "truthlab-world/v1/"+key, str(name))
        size=name.stat().st_size
        if size==0:
            raise ValueError("Video file is empty")
        meta={"snippet":{"title":title,"description":draft.get("text","")[:4900],
                         "categoryId":"22"},
              "status":{"privacyStatus":draft.get("privacy_level","private")}}
        if meta["status"]["privacyStatus"] not in ("public","unlisted","private"):
            raise ValueError("Invalid YouTube privacy status")
        url="https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
        headers={"Authorization":"Bearer "+access,"Content-Type":"application/json",
                 "X-Upload-Content-Type":"video/mp4","X-Upload-Content-Length":str(size)}
        initial=requests.post(url,headers=headers,json=meta,timeout=30)
        initial.raise_for_status()
        upload_url=initial.headers.get("Location")
        if not upload_url or not upload_url.startswith("https://www.googleapis.com/"):
            raise RuntimeError("YouTube did not provide a verified resumable upload URL")
        with name.open("rb") as f:
            complete=requests.put(upload_url,headers={"Content-Type":"video/mp4"},
                                  data=f,timeout=600)
        complete.raise_for_status()
        video_id=required_field(complete.json(),"id")
    return {"status":"published","id":video_id,
            "url":"https://www.youtube.com/watch?v="+video_id,"provider":"youtube-data-v3"}

def snapchat_post(draft):
    profile_id=mandatory("TRUTHLAB_SNAP_PUBLIC_PROFILE_ID")
    access=mandatory("TRUTHLAB_SNAP_USER_TOKEN")
    media_id=required_field(draft,"media_id")
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,160}",media_id):
        raise ValueError("Snap media must be uploaded and confirmed first")
    if not re.fullmatch(r"[a-fA-F0-9-]{36}",profile_id):
        raise ValueError("Invalid Snapchat Public Profile ID")
    kind=required_field(draft,"media_type").lower()
    base="https://businessapi.snapchat.com/v1/public_profiles/"+profile_id
    if kind=="spotlight":
        body={"media_id":media_id,"description":draft.get("text","")[:160],
              "locale":draft.get("locale","en_US")}
        endpoint=base+"/spotlights"
    elif kind=="story":
        body={"media_id":media_id}
        endpoint=base+"/stories"
    else:
        raise ValueError("Snapchat requires a preuploaded, verified Story or Spotlight media ID")
    res=social_request(endpoint,access,body,method="POST")
    if res.get("request_status")!="SUCCESS":
        raise RuntimeError("Snap Public Profile API did not confirm a successful creation")
    post_id=res.get("spotlight_id") or res.get("story_id")
    if not post_id:
        # The Story API may return SUCCESS/request_id without a created Story ID.
        # Never turn a successful request into an unverified public-post claim.
        request_id=res.get("request_id")
        if request_id:
            return {"status":"processing","request_id":str(request_id),
                    "provider":"snap-public-profile","public_post_verified":False}
        raise RuntimeError("Snap API returned no content ID or request identifier")
    return {"status":"published","id":str(post_id),"provider":"snap-public-profile"}

def platform_publish(platform, draft, ledger):
    if platform=="x":
        posted=XClient(ledger=ledger).create_post(required_field(draft,"text"))
        return {"status":"published",**posted,"provider":"x-api-v2"}
    if platform=="facebook": return facebook_post(draft)
    if platform=="threads": return threads_post(draft)
    if platform=="instagram": return instagram_post(draft)
    if platform=="reddit": return reddit_post(draft)
    if platform=="tiktok": return tiktok_post(draft)
    if platform=="youtube": return youtube_post(draft,ledger)
    if platform=="snapchat": return snapchat_post(draft)
    raise ValueError("Unsupported social platform")

def queue_draft(ledger, platform, content, research_id):
    if platform not in NETWORKS:
        raise ValueError("Unknown network")
    if not isinstance(content,dict) or not content.get("text"):
        raise ValueError("No empty or synthetic drafts")
    if not isinstance(research_id,str) or not research_id:
        raise ValueError("Only a source-linked research draft may be queued")
    draft={"platform":platform,"content":content,"research_id":research_id}
    draft_id=fingerprint(draft)[:24]
    ledger.save("social/drafts/"+draft_id+".json", {"id":draft_id,**draft,
          "hash":fingerprint(draft),"state":"review","created_at":timestamp()})
    return draft_id

def publish_approved(ledger,draft_id,platform,operator):
    if not re.fullmatch(r"[0-9a-f]{24}",draft_id):
        raise ValueError("Invalid draft identifier")
    if platform not in NETWORKS:
        raise ValueError("Unsupported platform")
    approved=mandatory("TRUTHLAB_APPROVER_GITHUB_LOGIN")
    if operator!=approved:
        raise PermissionError("Only authorized GitHub operator can publish")
    draft=ledger.load("social/drafts/"+draft_id+".json")
    if not draft or draft.get("platform")!=platform or draft.get("state")!="review":
        raise ValueError("Unknown or unreviewed platform-specific draft")
    raw={"platform":draft["platform"],"content":draft["content"],
         "research_id":draft["research_id"]}
    if fingerprint(raw)!=draft["hash"] or fingerprint(raw)[:24]!=draft_id:
        raise RuntimeError("Social draft was modified after review")
    base="social/"+platform+"/"+draft_id
    if ledger.load(base+"/published.json") or ledger.load(base+"/sending.json"):
        raise RuntimeError("Already sent or ambiguous social API request; reconcile first")
    # R2 has per-object atomic writes, but the caller must also hold an external
    # single-writer lease. The GitHub workflow concurrency group provides this.
    ledger.save(base+"/approval.json", {"operator":operator,"hash":draft["hash"],"at":timestamp()})
    # Mark *before* external request; a timeout must not accidentally post twice.
    ledger.save(base+"/sending.json",{"at":timestamp()})
    result=platform_publish(platform,draft["content"],ledger)
    ledger.save(base+"/receipt.json",{"result":result,"at":timestamp(),"draft_id":draft_id})
    if result.get("status")=="published":
        ledger.save(base+"/published.json",{"result":result,"at":timestamp(),"approved_by":operator})
    elif result.get("status")!="processing":
        raise RuntimeError("Unrecognized social publication status")
    return result

def confirm_tiktok(ledger,draft_id):
    receipt=ledger.load("social/tiktok/"+draft_id+"/receipt.json")
    if not receipt:
        raise ValueError("No actual TikTok publish request recorded")
    if receipt.get("result",{}).get("status")!="processing":
        return receipt["result"]
    result=tiktok_check(receipt["result"]["id"])
    if result["status"]=="published":
        ledger.save("social/tiktok/"+draft_id+"/published.json",
                    {"result":result,"at":timestamp(),"verified_from":"tiktok_api"})
    return result
