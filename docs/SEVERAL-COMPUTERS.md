# Several computers

Observatory works on one computer with no setup beyond `npm run setup`. This guide adds more computers, so a Mac, a Windows PC and a Linux computer share one view. Observatory supports one of each kind in total. A Linux computer is usually a headless machine where agents run: it collects tokens, limits and sessions, with no screen time and no tray or menu bar app.

## How it works

```
 Other computer                         Mac (hub)
 every 5 min: collect                    every 5 min: collect
   -> usage.json  ---- read over SSH ---->  combines all
                                            -> combined.json
   combined.incoming.json <-- written back over SSH --
   merged into combined.json on its next cycle
```

- One computer, called the hub, reads each other computer's `usage.json` over SSH, combines them with its own and writes `combined.json`. It sends the result back to each as `combined.incoming.json`, which that computer merges into its own `combined.json` on its next cycle. No computer opens a network port. The examples below use a Mac as the hub.
- Each other computer recombines its own fresh numbers with the last copy it received on every cycle, so its own numbers stay current when the hub is asleep. The hub's numbers then show their age.
- Limits come from the freshest reading on any computer and are not added together. Screen time, tokens and cost are shown per computer and as a sum labeled "not deduplicated". A Linux computer shows under its device name.

## Steps

1. Run `npm run setup` on each computer as in the README, and check that each works on its own.
2. Make sure the hub can reach each computer with SSH without a password prompt, for example over [Tailscale](https://tailscale.com/) with an SSH key. Use a host alias from `~/.ssh/config`, and check it once by hand:

   ```bash
   ssh my-pc
   ```

3. On the hub, add each other computer to `observatory.config.json`:

   ```json
   {
     "hub": {
       "spokes": [
         { "name": "PC", "ssh": "my-pc", "platform": "windows" }
       ]
     }
   }
   ```

   Keep the other settings as they are. The Mac finds the PC's data folder itself (`%LOCALAPPDATA%\Observatory`). Set `dataFolder` on the entry if you moved it.

4. Run `npm run setup` on the Mac again. It reports whether it reached the PC.

Within ten minutes every menu and dashboard lists every computer.

## What travels over SSH

The Mac runs two fixed commands on the PC: one reads `usage.json`, one writes `combined.incoming.json` through a temporary file and a rename, after checking its size. The PC merges that file itself, so the Mac never replaces a newer result the PC made. SSH runs in batch mode with strict host key checking and without agent, X11 or port forwarding. The files hold totals, limit readings and, for each agent session, its title, counts and repository folder names. They hold no prompts, messages, paths or credentials. Session titles are on by default. Set `"sessions": { "titles": false }` to send a short hash instead. The hub applies its own setting too: with titles off on the hub, titles from the other computers are hashed before `combined.json` is written.

## A Linux computer

`npm run setup` on Linux builds nothing and starts no app. It writes the settings file if there is none, then installs a systemd user timer that runs the collector every five minutes. `npm run setup -- --dry-run` prints the two unit files, and `npm run setup -- --remove` removes them.

- Where `systemctl --user` is not available, setup prints one crontab line to add with `crontab -e`, and changes nothing.
- A user timer stops when you log out unless lingering is on. Setup says when it is off. Turn it on once with `loginctl enable-linger $USER`.
- The settings file reads tokens, limits and sessions. Screen time reads Unknown on Linux, and `wsl` is refused.
- The data folder is `$XDG_DATA_HOME/observatory`, or `~/.local/share/observatory` when that is not set. Set `dataFolder` on the hub's entry if you moved it.

To add it to a Mac hub:

```json
{
  "hub": {
    "spokes": [
      { "name": "Build box", "ssh": "build-box", "platform": "linux" }
    ]
  }
}
```

The same two fixed commands run over SSH as for a Mac, so the Linux computer needs `sh`, `base64`, `wc` and `mv`.

## WSL on the PC

A computer's token totals cover the Claude Code and Codex logs saved on that computer. Logs live where the tool runs, so work started from the Mac that runs inside WSL on the PC (for example a Codex job over SSH) is saved in WSL and counts toward the PC. The Mac counts only the logs in its own home folder, so nothing is counted twice when the two are combined.

WSL keeps its files apart from Windows, so the PC reads them only when its settings file lists `wsl` as `true`:

```json
{
  "sources": { "claudeCode": true, "codex": true, "wsl": true }
}
```

With `wsl` on, each cycle on the PC:

- finds the installed WSL distributions in the Windows registry, leaving out the ones Docker Desktop, Rancher Desktop and Podman use,
- reads `.claude` and `.codex` under each folder in `/home` of each distribution through `\\wsl.localhost\<distribution>`, read-only, with the same readers as the Windows folders and a separate private Codex cache for each,
- adds the results to the Windows totals by day and model, and records which parts it covered, such as `Windows` and `WSL Ubuntu-24.04`, with no paths or user names.

A distribution without those folders adds nothing. If a folder exists but cannot be read, is a link, or the distribution cannot be reached, that provider's PC total is Unknown rather than smaller. Opening a stopped distribution's files starts it, as browsing it in File Explorer does, so with `wsl` on the distribution stays running. The share is available in the signed-in desktop session where the tray app runs, but usually not in an SSH session, so a collection started over SSH with `wsl` on shows Unknown. Folders set with `CODEX_HOME` or `CLAUDE_CONFIG_DIR` inside WSL and the root user's home are not read. A Mac or a Linux computer refuses the setting.

## If a computer is off

The hub keeps the last copy it read and shows its age. That computer's numbers for today show Unknown, not zero, and so does any sum that includes them.

To turn a computer off on purpose, set `"off": true` on its entry:

```json
{ "name": "PC", "ssh": "my-pc", "platform": "windows", "off": true }
```

The hub then does not reach it over SSH. Every menu, tray and dashboard shows it as Off instead of the time of its last reading, and its earlier sessions still count in the week. A computer that is on in the settings but cannot be reached still shows the time of its last reading. Remove the setting, or set it to `false`, to turn the computer back on.
