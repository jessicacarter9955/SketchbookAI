"""Private, exact-ID, supervised social operations. Never place draft text in Actions input/logs."""
import argparse
import json
import os
import re
from social_hub import NETWORKS, publish_approved, confirm_tiktok, queue_draft
from world_interface import R2Journal, timestamp

def run(argv=None, ledger=None):
    p=argparse.ArgumentParser()
    p.add_argument("action",choices=("status","publish","confirm-tiktok","queue-media"))
    p.add_argument("--platform",choices=NETWORKS)
    p.add_argument("--draft-id",default="")
    p.add_argument("--media-key",default="")
    args=p.parse_args(argv)
    journal=ledger if ledger is not None else R2Journal()
    if args.action=="status":
        return {"platforms":list(NETWORKS),
                "review":len(list(journal.list_keys("social/drafts/"))),
                "created_at":timestamp()}
    if not args.platform or not re.fullmatch(r"[0-9a-f]{24}",args.draft_id):
        raise ValueError("An exact network and existing immutable draft ID are mandatory")
    if args.action=="publish":
        result=publish_approved(journal,args.draft_id,args.platform,os.getenv("GITHUB_ACTOR",""))
        return {"platform":args.platform,"draft_id":args.draft_id,"result":result}
    if args.action=="confirm-tiktok":
        if args.platform!="tiktok":
            raise ValueError("Only TikTok uses publish/status/fetch")
        return confirm_tiktok(journal,args.draft_id)
    if args.action=="queue-media":
        raise PermissionError("Do not inject content through public workflow_dispatch; add media through the authenticated private dashboard.")
    raise ValueError("Unsupported action")

if __name__=="__main__":
    print(json.dumps(run(),ensure_ascii=False))
