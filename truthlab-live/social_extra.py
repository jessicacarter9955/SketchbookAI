"""Additional first-party social integrations: Bluesky, LinkedIn, Pinterest.

No synthetic success: these publish only with an actual provider receipt.
"""
import json
import os
import re
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import quote
from datetime import datetime, timezone

from world_interface import public_https_url, request_json

def _secret(name):
    val = os.getenv(name,"")
    if not val:
        raise RuntimeError("Unconfigured provider authorization: "+name)
    return val

def bluesky_post(content):
    text=content.get("text","")
    if not isinstance(text,str) or not 1<=len(text)<=300:
        raise ValueError("Bluesky text must be nonempty and at most 300 codepoints")
    identifier=_secret("TRUTHLAB_BSKY_IDENTIFIER")
    passwd=_secret("TRUTHLAB_BSKY_APP_PASSWORD")
    session=request_json("https://bsky.social/xrpc/com.atproto.server.createSession",
             method="POST",payload={"identifier":identifier,"password":passwd})
    did=session.get("did")
    access=session.get("accessJwt")
    if not isinstance(did,str) or not did.startswith("did:") or not access:
        raise RuntimeError("Bluesky authentication returned no valid DID or JWT")
    record={"$type":"app.bsky.feed.post","text":text,
            "createdAt":datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")}
    response=request_json("https://bsky.social/xrpc/com.atproto.repo.createRecord",
             token="Bearer "+access,method="POST",payload={"repo":did,
                      "collection":"app.bsky.feed.post","record":record})
    uri=response.get("uri","")
    if not isinstance(uri,str) or not uri.startswith("at://"+did+"/app.bsky.feed.post/"):
        raise RuntimeError("Bluesky did not return a verified post record URI")
    rkey=uri.rsplit("/",1)[-1]
    handle=session.get("handle",identifier)
    return {"status":"published","id":uri,"provider":"bluesky-atproto",
            "url":"https://bsky.app/profile/"+quote(handle,safe="")+"/post/"+quote(rkey,safe="")}

def linkedin_post(content):
    text=content.get("text","")
    if not isinstance(text,str) or not text.strip():
        raise ValueError("LinkedIn post requires text")
    actor=_secret("TRUTHLAB_LINKEDIN_AUTHOR_URN")
    if not re.fullmatch(r"urn:li:(person|organization):[A-Za-z0-9_-]{2,80}",actor):
        raise ValueError("LinkedIn author must be an authorized person or organization URN")
    version=os.getenv("TRUTHLAB_LINKEDIN_VERSION","202609")
    if not re.fullmatch(r"20\d{4}",version):
        raise ValueError("Invalid LinkedIn API version")
    data={"author":actor,"commentary":text[:3000],"visibility":"PUBLIC",
           "distribution":{"feedDistribution":"MAIN_FEED","targetEntities":[],
                           "thirdPartyDistributionChannels":[]},
           "lifecycleState":"PUBLISHED","isReshareDisabledByAuthor":False}
    req=Request("https://api.linkedin.com/rest/posts",
       data=json.dumps(data).encode("utf-8"),method="POST",
       headers={"Authorization":"Bearer "+_secret("TRUTHLAB_LINKEDIN_ACCESS_TOKEN"),
                "Content-Type":"application/json",
                "Linkedin-Version":version,
                "X-Restli-Protocol-Version":"2.0.0"})
    try:
        with urlopen(req,timeout=30) as response:
            if response.status!=201:
                raise RuntimeError("LinkedIn post was not accepted: HTTP "+str(response.status))
            urn=response.headers.get("x-restli-id")
    except HTTPError as exc:
        raise RuntimeError("LinkedIn API rejected post HTTP "+str(exc.code)) from None
    if not urn or not urn.startswith(("urn:li:share:","urn:li:ugcPost:")):
        raise RuntimeError("LinkedIn did not return its post ID")
    return {"status":"published","id":urn,"provider":"linkedin-posts"}

def pinterest_post(content):
    media_url=content.get("media_url","")
    board=content.get("board_id","")
    title=content.get("title","")
    if not isinstance(board,str) or not re.fullmatch(r"\d+",board):
        raise ValueError("Pinterest requires a real, explicitly selected board ID")
    if not isinstance(media_url,str):
        raise ValueError("Pinterest image URL required")
    public_https_url(media_url)
    if content.get("media_type","image")!="image":
        raise ValueError("Pinterest integration requires a real public image URL")
    payload={"board_id":board,"title":str(title)[:100],
             "description":str(content.get("text",""))[:800],
             "media_source":{"source_type":"image_url","url":media_url}}
    result=request_json("https://api.pinterest.com/v5/pins",
         token="Bearer "+_secret("TRUTHLAB_PINTEREST_ACCESS_TOKEN"),
         method="POST",payload=payload)
    pin_id=result.get("id")
    if not isinstance(pin_id,str) or not re.fullmatch(r"\d+",pin_id):
        raise RuntimeError("Pinterest did not confirm a Pin ID")
    return {"status":"published","id":pin_id,"provider":"pinterest-v5",
            "url":"https://www.pinterest.com/pin/"+pin_id+"/"}
