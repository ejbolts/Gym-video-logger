from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows PowerShell launch profiles")
PROFILE_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "launch-profile.ps1"


def git(root: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *arguments], check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


@pytest.fixture
def worktrees(tmp_path):
    repo = tmp_path / "source"
    repo.mkdir()
    git(repo, "init", "-b", "main")
    (repo / "README.md").write_text("test project", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "seed")
    commit = git(repo, "rev-parse", "HEAD")
    verification = tmp_path / "feature worktree"
    stable = tmp_path / "stable worktree"
    git(repo, "worktree", "add", "-b", "test-feature", str(verification), commit)
    git(repo, "worktree", "add", "--detach", str(stable), commit)
    return repo, verification, stable, commit


def ps_quote(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def profile(root, *, mode="Verification", commit=None, data=None, dev=False):
    command = (
        "$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest; "
        f". {ps_quote(PROFILE_SCRIPT)}; "
        f"Get-GymLaunchProfile -ProjectRoot {ps_quote(root)} -Environment {ps_quote(mode)}"
    )
    if commit:
        command += f" -VerifiedCommit {ps_quote(commit)}"
    if data:
        command += f" -DataRoot {ps_quote(data)}"
    if dev:
        command += " -Dev"
    command += " | ConvertTo-Json -Depth 5 -Compress"
    encoded = base64.b64encode(command.encode("utf-16-le")).decode("ascii")
    return subprocess.run(
        [shutil.which("powershell"), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        capture_output=True,
        text=True,
    )


def test_profiles_separate_ports_builds_storage_and_credentials(worktrees, tmp_path):
    _, verification, stable, commit = worktrees
    preview_result = profile(verification)
    stable_result = profile(stable, mode="Stable", commit=commit, data=tmp_path / "real data")
    assert preview_result.returncode == 0, preview_result.stderr
    assert stable_result.returncode == 0, stable_result.stderr
    preview, production = json.loads(preview_result.stdout), json.loads(stable_result.stdout)
    assert (preview["BackendPort"], preview["HttpsPort"]) == (8001, 8447)
    assert (production["BackendPort"], production["HttpsPort"]) == (8000, 8446)
    assert preview["FrontendDist"] != production["FrontendDist"]
    assert preview["Variables"]["GYM_YOUTUBE_MOCK_MODE"] == "true"
    assert preview["Variables"]["GYM_BACKEND_URL"] == "http://127.0.0.1:8001"
    assert preview["Variables"]["GYM_SEED_SAMPLE_DATA"] == "true"
    assert production["Variables"]["GYM_SEED_SAMPLE_DATA"] == "false"
    for key in ["GYM_DATABASE_PATH", "GYM_WEB_PUSH_VAPID_PRIVATE_KEY_PATH"]:
        assert preview["Variables"][key] != production["Variables"][key]
    for key in ["GYM_YOUTUBE_TOKEN_PATH", "GYM_YOUTUBE_CLIENT_SECRET_PATH"]:
        assert Path(preview["Variables"][key]).is_relative_to(verification / ".runtime")
    assert not (verification / ".runtime").exists(), "profile inspection must not create data"


@pytest.mark.parametrize("case", ["no-commit", "wrong-commit", "dirty", "branch", "dev"])
def test_stable_refuses_unverified_or_mutable_checkouts(worktrees, tmp_path, case):
    _, verification, stable, commit = worktrees
    target = verification if case == "branch" else stable
    if case == "dirty":
        (stable / "README.md").write_text("unverified edits", encoding="utf-8")
    result = profile(
        target,
        mode="Stable",
        commit=None if case == "no-commit" else ("deadbeef" if case == "wrong-commit" else commit),
        data=tmp_path / "real data",
        dev=case == "dev",
    )
    assert result.returncode != 0
    assert not (tmp_path / "real data").exists()


def test_verification_refuses_main_checkout_and_real_data(worktrees, tmp_path):
    repo, verification, _, _ = worktrees
    assert profile(repo).returncode != 0
    assert profile(verification, data=tmp_path / "real data").returncode != 0


def test_stable_refuses_verification_data_root(worktrees):
    _, verification, stable, commit = worktrees
    storage = verification / ".runtime" / "verification-data"
    storage.mkdir(parents=True)
    (storage / ".gym-environment").write_text("Verification", encoding="utf-8")
    result = profile(stable, mode="Stable", commit=commit, data=storage)
    assert result.returncode != 0
    assert "other environment" in result.stderr
