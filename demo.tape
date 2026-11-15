Output demo.svg

Set Shell "bash --norc --noprofile"
Set Theme "Catppuccin Mocha"
Set Width 1120
Set Height 860
Set FontSize 13
Set Padding 18
Set TypingSpeed 40ms

# Quietly prepare environment and prompt
Hide
Type "REAL_GIT=$(which git); chmod +x \"$PWD/dist/cli.mjs\"; mkdir -p /tmp/uncat-demo-bin && ln -sf \"$PWD/dist/cli.mjs\" /tmp/uncat-demo-bin/uncat && printf '#!/bin/sh\nsleep 0.8\nexec %s \"$@\"\n' \"$REAL_GIT\" > /tmp/uncat-demo-bin/git && chmod +x /tmp/uncat-demo-bin/git"
Enter
Type "unset CI GITHUB_ACTIONS CONTINUOUS_INTEGRATION; export PATH=/tmp/uncat-demo-bin:$PATH PS1='❯ ' FORCE_COLOR=3 BAT_PAGING=never"
Enter
Type "rm -f demo/prompt_.md"
Enter
Type "clear"
Enter
Wait /❯/
Show

Sleep 600ms

# 1. View input prompt (referencing file slice, directory, command, and comment)
Type "bat --style=plain demo/prompt.md"
Sleep 300ms
Enter
Wait+Screen /git log/
Sleep 2500ms

# 2. Run uncat with live heads-up display (HUD)
Hide
Type "clear"
Enter
Wait /❯/
Show

Sleep 300ms
Type "uncat demo/prompt.md"
Sleep 300ms
Enter
Wait+Screen /done/
Sleep 4500ms

# 3. View expanded output with wrappers and hoisted blocks
Hide
Type "clear"
Enter
Wait /❯/
Show

Sleep 300ms
Type "bat --style=plain demo/prompt_.md"
Sleep 300ms
Enter
Wait+Screen /shell/
Sleep 4s
