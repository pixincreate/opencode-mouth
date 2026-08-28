#!/usr/bin/env bash
set -euo pipefail

REPO="pixincreate/opencode-mouth"
REPO_URL_DEFAULT="https://github.com/${REPO}.git"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
MANAGED_START="opencode-mouth:start"
MANAGED_END="opencode-mouth:end"

mode="release"
version="${MOUTH_INSTALL_VERSION:-}"

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [options]

Install the OpenCode Mouth TUI plugin.

Options:
  --clone       Clone/build locally and point OpenCode at the local dist/tui.js
  --uninstall   Remove the managed OpenCode plugin entry and installed files
  --version X   Install release version X.Y.Z (default: latest release)
  -h, --help    Show this help

Environment overrides:
  MOUTH_INSTALL_CONFIG      default: ~/.config/opencode/tui.jsonc
  MOUTH_INSTALL_STATE_DIR   default: ~/.local/share/opencode-mouth
  MOUTH_INSTALL_REPO_URL    default: https://github.com/pixincreate/opencode-mouth.git
  MOUTH_INSTALL_PLUGIN_SRC  install plugin file from a local path instead of a release
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clone)
      mode="clone"
      shift
      ;;
    --uninstall)
      mode="uninstall"
      shift
      ;;
    --version)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --version requires a value" >&2
        exit 1
      fi
      version="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

home_dir="${HOME:?HOME is required}"
config_file="${MOUTH_INSTALL_CONFIG:-${home_dir}/.config/opencode/tui.jsonc}"
state_dir="${MOUTH_INSTALL_STATE_DIR:-${home_dir}/.local/share/opencode-mouth}"
repo_dir="${state_dir}/repo"
repo_url="${MOUTH_INSTALL_REPO_URL:-$REPO_URL_DEFAULT}"
plugin_file="${state_dir}/tui.js"

log() {
  printf '%s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command not found: $1" >&2
    exit 1
  fi
}

latest_version() {
  require_command curl
  curl -fsSL "$API_URL" \
    | tr ',' '\n' \
    | awk -F'"' '/"tag_name"/ { print $4; exit }' \
    | sed 's/^v//'
}

validate_version() {
  if ! [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "Error: version must be semver, for example 0.1.0" >&2
    exit 1
  fi
}

plugin_block() {
  local spec="$1"
  cat <<EOF
    // ${MANAGED_START}
    "${spec}",
    // ${MANAGED_END}
EOF
}

strip_managed_plugin() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"
  awk -v start="$MANAGED_START" -v end="$MANAGED_END" '
    index($0, start) { skip = 1; next }
    index($0, end) { skip = 0; next }
    !skip { print }
  ' "$file" >"$tmp"
  mv "$tmp" "$file"
}

write_plugin_config() {
  local spec="$1"
  local dir tmp block_file
  dir="$(dirname "$config_file")"
  mkdir -p "$dir"

  if [[ ! -f "$config_file" ]]; then
    cat >"$config_file" <<EOF
{
  "plugin": [
$(plugin_block "$spec")
  ]
}
EOF
    return
  fi

  strip_managed_plugin "$config_file"
  tmp="$(mktemp)"
  block_file="$(mktemp)"
  plugin_block "$spec" >"$block_file"

  if grep -Eq '"plugin"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]' "$config_file"; then
    awk -v block_file="$block_file" '
      /"plugin"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]/ {
        sub(/\[[[:space:]]*\]/, "[")
        print
        while ((getline line < block_file) > 0) print line
        close(block_file)
        print "  ]"
        next
      }
      { print }
    ' "$config_file" >"$tmp"
  elif grep -Eq '"plugin"[[:space:]]*:[[:space:]]*\[' "$config_file"; then
    awk -v block_file="$block_file" '
      inserted == 0 && /"plugin"[[:space:]]*:[[:space:]]*\[/ {
        print
        while ((getline line < block_file) > 0) print line
        close(block_file)
        inserted = 1
        next
      }
      { print }
    ' "$config_file" >"$tmp"
  elif grep -Eq '^[[:space:]]*\{[[:space:]]*\}[[:space:]]*$' "$config_file"; then
    cat >"$tmp" <<EOF
{
  "plugin": [
$(plugin_block "$spec")
  ]
}
EOF
  else
    awk -v block_file="$block_file" '
      inserted == 0 && /^[[:space:]]*\{/ {
        print
        print "  \"plugin\": ["
        while ((getline line < block_file) > 0) print line
        close(block_file)
        print "  ],"
        inserted = 1
        next
      }
      { print }
    ' "$config_file" >"$tmp"
  fi

  mv "$tmp" "$config_file"
  rm -f "$block_file"
}

install_release() {
  local install_version plugin_url
  mkdir -p "$state_dir"

  if [[ -n "${MOUTH_INSTALL_PLUGIN_SRC:-}" ]]; then
    cp "$MOUTH_INSTALL_PLUGIN_SRC" "$plugin_file"
  else
    install_version="$version"
    if [[ -z "$install_version" ]]; then
      install_version="$(latest_version)"
    fi
    validate_version "$install_version"
    require_command curl
    plugin_url="https://github.com/${REPO}/releases/download/v${install_version}/tui.js"
    curl -fsSL "$plugin_url" -o "$plugin_file"
  fi

  write_plugin_config "$plugin_file"

  log "Installed plugin to ${plugin_file}"
  log "Configured OpenCode TUI plugin in ${config_file}"
  log "Restart OpenCode and run /behavior"
}

install_clone() {
  require_command git
  require_command npm

  if [[ -d "$repo_dir/.git" ]]; then
    git -C "$repo_dir" pull --ff-only
  else
    mkdir -p "$(dirname "$repo_dir")"
    git clone "$repo_url" "$repo_dir"
  fi

  (cd "$repo_dir" && npm install && npm run build)

  write_plugin_config "${repo_dir}/dist/tui.js"

  log "Configured local OpenCode TUI plugin in ${config_file}"
  log "Restart OpenCode and run /behavior"
}

uninstall() {
  if [[ -f "$config_file" ]]; then
    strip_managed_plugin "$config_file"
  fi
  rm -rf "$state_dir"

  log "Removed ${state_dir}"
  log "Removed managed OpenCode TUI plugin entry from ${config_file}"
}

case "$mode" in
  release) install_release ;;
  clone) install_clone ;;
  uninstall) uninstall ;;
esac
