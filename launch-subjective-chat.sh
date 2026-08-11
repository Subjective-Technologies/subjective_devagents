#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # Load nvm so Cinnamon launchers can find npm even outside an interactive shell.
  . "$NVM_DIR/nvm.sh"
fi

cd /home/goldenthinker/subjective_chat
exec npm start
