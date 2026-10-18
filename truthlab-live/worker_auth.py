"""Verify short-lived GitHub Actions OIDC identities before sharing a DB URI.

Never accept an unsigned token or a token from another repository / workflow.
GitHub's RSA signing keys come from its fixed official JWKS issuer.
"""
import os
import subprocess
import sys
from pathlib import Path

ISSUER = "https://token.actions.githubusercontent.com"
AUDIENCE = "truthlab-render-database-v1"
REPOSITORY = "jessicacarter9955/SketchbookAI"
REPOSITORY_ID = "1401449333"
WORKFLOW_REF = REPOSITORY + "/.github/workflows/truthlab-autonomous-tick.yml@refs/heads/main"
ALLOWED_EVENTS = frozenset({"schedule", "workflow_dispatch"})


def validate_claims(claims, allow_probe=False):
    """Additional explicit trust limits AFTER library has verified RSA signature."""
    expected = {
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "ref": "refs/heads/main",
        "workflow_ref": WORKFLOW_REF,
        "runner_environment": "github-hosted",
    }
    for field, value in expected.items():
        if str(claims.get(field, "")) != value:
            raise ValueError("OIDC identity mismatch: "+field)
    valid_events = ALLOWED_EVENTS | ({"push"} if allow_probe else set())
    if claims.get("event_name") not in valid_events:
        raise ValueError("OIDC event type not authorized")
    if claims.get("repository_visibility") != "public":
        raise ValueError("Unexpected repository visibility")
    # Do not allow untrusted PR or tag contexts.
    if claims.get("ref_type") != "branch":
        raise ValueError("OIDC ref must be an exact main branch")
    return True


def verify_github_oidc(token, allow_probe=False):
    if not isinstance(token, str) or not 100 <= len(token) <= 8192:
        raise ValueError("Missing or malformed JWT")
    try:
        import jwt
    except ImportError as exc:
        if os.getenv("TRUTHLAB_OIDC_BOOTSTRAP") != "1":
            raise RuntimeError("PyJWT is required for OIDC") from exc
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
             "--no-input", "PyJWT[crypto]>=2.10,<3"],
            check=True, timeout=180,
        )
        import jwt
    key_provider = jwt.PyJWKClient(ISSUER + "/.well-known/jwks",
                                  cache_keys=True, lifespan=300, timeout=12)
    signing_key = key_provider.get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token, signing_key.key,
        algorithms=["RS256"], issuer=ISSUER, audience=AUDIENCE,
        options={"require": ["exp", "iat", "nbf", "iss", "aud"]},
        leeway=15,
    )
    validate_claims(claims, allow_probe=allow_probe)
    return claims
