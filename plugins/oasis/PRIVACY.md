# Privacy

The Oasis plugin and the Oasis app run on your own machine.

- The plugin talks only to the Oasis on `127.0.0.1` (ports 4516 and 4530). It sends the session id, the session's working folder and the text of replies, so the village can show the session.
- The Oasis app reads your Claude Code session transcripts in `~/.claude/projects` to list your sessions and show their history. It keeps its own data (the roster of agents, their character cards, your world) in its own folder on your disk.
- Nothing is collected by the authors. There is no account, no telemetry and no analytics.
- Optional features that you switch on yourself with your own key (for example a spoken voice from a speech service) send the text to be spoken to that service under your account with it. They are off until you add a key.
- To remove everything: uninstall the plugin and delete the Oasis folder.

Questions: lvttrk@gmail.com, or open an issue at https://github.com/Parzival-Moksha/uploader/issues
