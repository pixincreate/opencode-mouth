#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/release.sh <version>

Example:
  scripts/release.sh 1.0.1

The default branch is protected: changes land through squash-merged pull
requests with required status checks. This script bumps the version on a
release branch, opens a PR, merges it once checks pass, then tags the
squash commit and pushes the tag.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

version="${1:-}"
if [[ -z "$version" ]]; then
  usage >&2
  exit 1
fi

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Error: version must be semver, for example 1.0.1" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh is required for the pull request release flow" >&2
  exit 1
fi

branch="$(git branch --show-current)"
if [[ "$branch" != "master" && "$branch" != "main" ]]; then
  echo "Error: release from master or main, not ${branch}" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean" >&2
  exit 1
fi

tag="v${version}"
if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "Error: tag ${tag} already exists" >&2
  exit 1
fi

git pull --ff-only origin "$branch"

release_branch="release/${tag}"
git switch -c "$release_branch"

cleanup_branch() {
  git switch "$branch" >/dev/null 2>&1 || true
  git branch -D "$release_branch" >/dev/null 2>&1 || true
}

current_version="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
if [[ "$current_version" != "$version" ]]; then
  npm version "$version" --no-git-tag-version
fi

npm run check
npm pack --dry-run

if git diff --quiet -- package.json package-lock.json; then
  echo "Error: nothing to release; package.json is already at ${version}" >&2
  cleanup_branch
  exit 1
fi

git add package.json package-lock.json
git commit -m "chore: release ${tag}"
git push -u origin "$release_branch"

pr_url="$(gh pr create \
  --title "chore: release ${tag}" \
  --body "Version bump for ${tag}. Merging this PR is followed by tagging the squash commit, which triggers the release workflow." \
  --base "$branch" \
  --head "$release_branch")"
echo "Opened ${pr_url}"

if ! gh pr merge "$release_branch" --squash --auto --delete-branch; then
  echo "Auto-merge unavailable; waiting for required checks..."
  attempts=0
  # `gh pr checks --watch` exits nonzero while checks are still unreported,
  # so retry until they appear and pass.
  until gh pr checks "$release_branch" --watch; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 30 ]]; then
      echo "Error: required checks did not pass for ${release_branch}" >&2
      cleanup_branch
      exit 1
    fi
    sleep 10
  done
  gh pr merge "$release_branch" --squash --delete-branch
fi

echo "Waiting for the release PR to merge..."
merge_sha=""
for _ in $(seq 1 60); do
  state="$(gh pr view "$release_branch" --json state --jq .state)"
  if [[ "$state" == "MERGED" ]]; then
    merge_sha="$(gh pr view "$release_branch" --json mergeCommit --jq .mergeCommit.oid)"
    break
  fi
  sleep 5
done

if [[ -z "$merge_sha" ]]; then
  echo "Error: release PR did not merge in time. Merge it, then tag the squash commit with ${tag} manually." >&2
  cleanup_branch
  exit 1
fi

git switch "$branch"
git pull --ff-only origin "$branch"
git branch -D "$release_branch" >/dev/null 2>&1 || true

git tag -a "$tag" -m "opencode-mouth ${tag}" "$merge_sha"
git push origin "$tag"

echo "Released ${tag} at ${merge_sha}."
