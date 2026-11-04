# Render from the repository root: vhs docs/demo.tape
# Everything shown comes from a fictional status-line payload written to a temp directory.
# CLAUDE_USAGE_FILE and CLAUDE_USAGE_CACHE_FILE keep real quota files out of the recording.
Output docs/assets/demo.gif
Set Shell "bash"
Set FontSize 18
Set Width 1000
Set Height 560
Set Padding 16
Set Framerate 12
Set TypingSpeed 45ms

Hide
Type `D=$(mktemp -d); export CLAUDE_USAGE_FILE=$D/usage.json CLAUDE_USAGE_CACHE_FILE=$D/cache.json PS1='$ '`
Enter
Type `T=$(date +%s); echo "{\"rate_limits\":{\"five_hour\":{\"used_percentage\":59,\"resets_at\":$((T+13440))},\"seven_day\":{\"used_percentage\":10,\"resets_at\":$((T+585000))}}}" > $D/status.json`
Enter
Type "node usage.mjs dump < $D/status.json > /dev/null; clear"
Enter
Sleep 300ms
Show

Sleep 500ms
Type "node usage.mjs"
Enter
Sleep 2200ms
Type "node usage.mjs remaining claude --min 15"
Enter
Sleep 2500ms
Type "node usage.mjs remaining claude --min 50 >/dev/null || echo 'Wait for the reset.'"
Enter
Sleep 2500ms
Type "node usage.mjs statusline < $D/status.json"
Enter
Sleep 2500ms
