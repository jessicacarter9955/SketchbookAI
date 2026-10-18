"""Fetch a PostgreSQL connection through GitHub's short-lived OIDC identity.

The DB URL is only written to the ephemeral GitHub Actions environment file;
it is never committed to a repository, included in report logs or test artifacts.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

AUDIENCE = "truthlab-render-database-v1"
ENDPOINT = "https://truthlab-agents-open.onrender.com/api/worker/credentials"


def main():
    oidc_url = os.getenv("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    request_token = os.getenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    env_path = os.getenv("GITHUB_ENV", "")
    if not (oidc_url and request_token and env_path):
        print("TRUTHLAB_DB_BRIDGE_SKIP: no GitHub OIDC job identity", flush=True)
        return 2

    delimiter = "&" if "?" in oidc_url else "?"
    url = oidc_url + delimiter + urllib.parse.urlencode({"audience": AUDIENCE})
    req = urllib.request.Request(
        url,
        headers={"Authorization": "Bearer "+request_token,
                 "Accept": "application/json; api-version=2.0"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.load(resp)
    identity = payload.get("value")
    if not isinstance(identity, str) or len(identity) < 100:
        raise RuntimeError("OIDC issuer did not return an ID token")

    verified = urllib.request.Request(
        ENDPOINT,
        headers={"Authorization": "Bearer "+identity,
                 "Accept": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(verified, timeout=100) as resp:
                data = json.load(resp)
            break
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 503):
                print("TRUTHLAB_DB_BRIDGE_SKIP: Render cloud database unavailable", flush=True)
                return 2
            # A 401 from the credential broker is a security failure, not "no DB".
            raise
        except (TimeoutError, urllib.error.URLError):
            if attempt == 2:
                print("TRUTHLAB_DB_BRIDGE_SKIP: Render service unreachable", flush=True)
                return 2
            time.sleep(12)
    connection_url = data.get("database_url")
    if not isinstance(connection_url, str) or not connection_url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("OIDC broker did not supply a PostgreSQL URL")

    # The GitHub runner processes ::add-mask before rendering later log lines.
    print("::add-mask::"+connection_url, flush=True)
    with open(env_path, "a", encoding="utf-8") as file:
        file.write("TRUTHLAB_DATABASE_URL="+connection_url+"\n")
    print("TRUTHLAB_DB_BRIDGE_SUCCESS signed GitHub identity accepted", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
