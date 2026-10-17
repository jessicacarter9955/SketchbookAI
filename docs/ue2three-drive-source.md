# Import DDS source from Google Drive into ue2three

The converter already supports local Unreal source, cached exports and partial Blueprint migration. This staging tool fills a separate gap: it checks whether a Google Drive folder actually contains **binary source assets** before migrating, then makes verified local copies without altering originals.

- Metadata check (no asset download):
  `python tools/ue2three/drive_source.py --folder-id YOUR_FOLDER_ID`
- Opt-in staging, preserving original filenames and bytes:
  `python tools/ue2three/drive_source.py --folder-id YOUR_FOLDER_ID --download --destination .local/ue2three/drive-source`
- Set `GOOGLE_DRIVE_ACCESS_TOKEN` in the local environment to a short-lived OAuth token with read access. Never place tokens in the repo, command arguments or workflow logs.
- After successful staging of a **complete** project, run `python tools/ue2three/ue2three.py scan .local/ue2three/drive-source/YOUR_PROJECT.uproject`. Actual character/map exports still require compatible Unreal Engine tools. Cached Blueprint migration remains a distinct phase.

The script rejects missing or nested project descriptors, missing `.uasset`/`.umap` files under Content, unsafe path names, duplicate/case-insensitive collisions, Google-native documents, downloads with invalid checksums, and conflicting local files. It does not invent missing source assets or assert that a folder-only upload is convertible. Use the offline tests in `tools/ue2three/tests/test_drive_source.py`.

**Source status (17 October 2026):** the connected `VIPDDSExtractionKitv2.1` Google Drive tree was located and browsed. The checked mannequin/weapon source subfolders were empty, and the root listed only Content/ and Config/ folders. An original `.uproject` and complete source packages were not available in those queries. This status is a *partial folder inspection*, not a full recursive Drive inventory. The last Codex migration results and locally cached exports are not present in the Git repository and cannot be recreated from folder names.

Do not commit staged assets, exported GLBs or API credentials. Preserve licensing for the original DDS kit; the code and tests here contain no purchased content.
