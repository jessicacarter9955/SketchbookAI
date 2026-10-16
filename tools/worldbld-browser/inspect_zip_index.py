#!/usr/bin/env python3
"""Read only 8 MiB or less of the official plugin ZIP's central directory.

The ZIP's 2.5GB content is never downloaded or redistributed. Logs store
ONLY archive entry names/extensions, no signed URLs, cookies, or file bodies.
"""
import json
import struct
import urllib.request
from pathlib import Path

URL = "https://worldbld.com/launchpad/6a2a005e4ae90b110f0e416b/download"
MAX_TRANSFER = 8*1024*1024
OUT = Path("tools/worldbld-browser/results/worldbld-zip-index.json")

def get_range(suffix=None, start=None, end=None):
    value = "bytes=-131072" if suffix else f"bytes={start}-{end}"
    req = urllib.request.Request(URL,headers={"User-Agent":"WorldBLD-CompatibilityIndex/1.0","Range":value})
    with urllib.request.urlopen(req,timeout=35) as r:
        if r.status != 206: raise RuntimeError("Server did not honor HTTP Range request")
        body = r.read(MAX_TRANSFER+1)
        if len(body)>MAX_TRANSFER: raise ValueError("Refused oversized server response")
        cr=r.headers.get("Content-Range","")
    if "/" not in cr: raise RuntimeError("No Content-Range")
    return body, int(cr.split("/")[-1])

def main():
    result={"read_only":True,"unreal_executed":False,"gpu_hours":0,
     "raw_package_downloaded":False,"max_transfer_bytes":MAX_TRANSFER,"not_license_validation":True}
    try:
        tail,total = get_range(suffix=True)
        pos=tail.rfind(b"PK"+bytes([5,6]))
        if pos<0:raise ValueError("Classic ZIP end-of-central-directory not found in last 128 KiB")
        if pos+22>len(tail): raise ValueError("Invalid EOCD position")
        eocd=struct.unpack_from("<IHHHHIIH",tail,pos)
        count,cd_size,cd_offset=eocd[4],eocd[5],eocd[6]
        if cd_size==0xffffffff or count==65535:raise ValueError("ZIP64 central directory; increase parser support")
        if cd_size>MAX_TRANSFER:raise ValueError("ZIP index too large for safety cap")
        if cd_offset+cd_size>total:raise ValueError("Invalid central dir positions")
        cd,total2=get_range(start=cd_offset,end=cd_offset+cd_size-1)
        if total2!=total or len(cd)!=cd_size:raise ValueError("Range did not match central directory")
        names=[]; p=0
        while p<len(cd):
            if cd[p:p+4]!=b"PK"+bytes([1,2]): raise ValueError("Bad central directory header")
            name_len,extras_len,comment_len=struct.unpack_from("<HHH",cd,p+28)
            raw_name=cd[p+46:p+46+name_len]
            name=raw_name.decode("utf-8","replace")
            names.append(name)
            p+=46+name_len+extras_len+comment_len
        platform_counts={"windows_dll":sum(n.lower().endswith(".dll") for n in names),
          "linux_so":sum(n.lower().endswith(".so") for n in names),
          "mac_dylib":sum(n.lower().endswith(".dylib") for n in names)}
        result.update({"success":True,"archive_bytes":total,"entries":len(names),
          "index_bytes":cd_size,"platform_counts":platform_counts,
          "plugin_descriptors":[n for n in names if n.lower().endswith(".uplugin")][:100],
          "engine_binaries_count":sum("binaries/" in n.lower() for n in names),
          "first_paths":names[:18]})
    except Exception as e:
        result.update({"success":False,"error_type":type(e).__name__,"message":str(e)})
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))
    # A successful completion means diagnostic results exist even when the
    # upstream ZIP index is not supported.
if __name__=="__main__":main()
