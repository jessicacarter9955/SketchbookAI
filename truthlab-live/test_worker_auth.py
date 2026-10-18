"""GitHub OIDC claim pinning tests; no real tokens or secrets in tests."""
import unittest
from worker_auth import validate_claims, REPOSITORY, REPOSITORY_ID, WORKFLOW_REF


def identity():
    return {
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "workflow_ref": WORKFLOW_REF,
        "ref": "refs/heads/main",
        "ref_type": "branch",
        "runner_environment": "github-hosted",
        "repository_visibility": "public",
        "event_name": "schedule",
    }


class OIDCPermissions(unittest.TestCase):
    def test_exact_schedule_identity_allowed(self):
        self.assertTrue(validate_claims(identity()))

    def test_dispatch_allowed(self):
        data = identity()
        data["event_name"] = "workflow_dispatch"
        self.assertTrue(validate_claims(data))

    def test_push_only_allowed_as_noncredential_probe(self):
        data = identity()
        data["event_name"] = "push"
        with self.assertRaises(ValueError):
            validate_claims(data)
        self.assertTrue(validate_claims(data, allow_probe=True))

    def test_wrong_repository_workflow_or_runner_denied(self):
        for key, wrong in [
            ("repository","another/repository"),
            ("repository_id","000"),
            ("workflow_ref","another/flow@refs/heads/main"),
            ("ref","refs/heads/feature"),
            ("ref_type","tag"),
            ("runner_environment","self-hosted"),
            ("repository_visibility","private"),
            ("event_name","pull_request"),
        ]:
            data = identity()
            data[key] = wrong
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_claims(data)


if __name__ == "__main__":
    unittest.main()
