#!/data/data/com.termux/files/usr/bin/sh
set -eu

pkg install -y git gh nodejs ripgrep tmux

BRIDGE_DIR="$HOME/projects/couchcode"
OWNER="${COUCHCODE_OWNER:-$(gh api user --jq .login)}"
SOURCE_REPO="${COUCHCODE_SOURCE_REPO:-$OWNER/couchcode}"
CONTROL_REPO="${COUCHCODE_CONTROL_REPO:-}"
DEVICE_ID="${COUCHCODE_DEVICE_ID:-}"
CONTROL_ISSUE="${COUCHCODE_CONTROL_ISSUE:-}"

fail() { printf 'CouchCode setup error: %s\n' "$1" >&2; exit 1; }
[ -n "$CONTROL_REPO" ] || fail 'Set COUCHCODE_CONTROL_REPO to a separate private repository.'
[ "$CONTROL_REPO" != "$SOURCE_REPO" ] || fail 'The control repository must be different from the public source repository.'
[ -n "$CONTROL_ISSUE" ] || fail 'Set COUCHCODE_CONTROL_ISSUE to the private control issue number.'
case "$CONTROL_ISSUE" in *[!0-9]*|'') fail 'COUCHCODE_CONTROL_ISSUE must be numeric.' ;; esac
printf '%s' "$DEVICE_ID" | grep -Eq '^[a-zA-Z0-9._:-]{8,100}$' || fail 'Set a valid COUCHCODE_DEVICE_ID.'

[ "$(gh api "repos/$CONTROL_REPO" --jq '.private')" = "true" ] || fail 'The control repository must be private.'
gh api "repos/$CONTROL_REPO/issues/$CONTROL_ISSUE" --silent >/dev/null || fail 'The configured control issue does not exist.'

mkdir -p "$HOME/projects" "$HOME/.termux"
if grep -q '^allow-external-apps=' "$HOME/.termux/termux.properties" 2>/dev/null; then
  sed -i 's/^allow-external-apps=.*/allow-external-apps=true/' "$HOME/.termux/termux.properties"
else
  printf '\nallow-external-apps=true\n' >> "$HOME/.termux/termux.properties"
fi

if [ -d "$BRIDGE_DIR/.git" ]; then
  git -C "$BRIDGE_DIR" pull --ff-only
else
  gh repo clone "$SOURCE_REPO" "$BRIDGE_DIR"
fi

COUCHCODE_DEVICE_ID="$DEVICE_ID" \
COUCHCODE_REPO="$CONTROL_REPO" \
COUCHCODE_ISSUE="$CONTROL_ISSUE" \
COUCHCODE_OWNER="$OWNER" \
node "$BRIDGE_DIR/agent/bootstrap.mjs"

cat > "$HOME/.couchcode/start-agent" <<'SCRIPT'
#!/data/data/com.termux/files/usr/bin/sh
cd "$HOME/projects/couchcode"
exec node agent/agent.mjs --idle-timeout 300
SCRIPT
chmod 700 "$HOME/.couchcode/start-agent"
termux-wake-lock || true
tmux kill-session -t couchcode 2>/dev/null || true
tmux new-session -d -s couchcode "$HOME/.couchcode/start-agent"

echo "CouchCode template installed."
echo "Device: $DEVICE_ID"
echo "Control: $CONTROL_REPO#$CONTROL_ISSUE"
echo "Register CouchCode projects with: node $BRIDGE_DIR/agent/register-project.mjs <alias> <path>"
