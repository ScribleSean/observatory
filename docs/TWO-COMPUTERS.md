# Two computers

Observatory works on one computer with no setup beyond `npm run setup`. This guide adds a second computer, so a Mac and a Windows PC share one view. One Mac and one Windows PC are supported in total.

## How it works

```
 PC                                      Mac (hub)
 every 5 min: collect                    every 5 min: collect
   -> usage.json  ---- read over SSH ---->  combines both
                                            -> combined.json
   combined.incoming.json <-- written back over SSH --
   merged into combined.json on the PC's next cycle
```

- The Mac, called the hub, reads the PC's `usage.json` over SSH, combines it with its own and writes `combined.json`. It sends the result to the PC as `combined.incoming.json`, which the PC merges into its own `combined.json` on its next cycle. Neither computer opens a network port.
- The PC recombines its own fresh numbers with the last copy it received on every cycle, so its own numbers stay current when the Mac is asleep. The Mac's numbers then show their age.
- Limits come from the freshest reading on either computer and are never added. Screen time, tokens and cost are shown per computer and as a sum labeled "not deduplicated".

## Steps

1. Run `npm run setup` on both computers as in the README, and check that each works on its own.
2. Make sure the Mac can reach the PC with SSH without a password prompt, for example over [Tailscale](https://tailscale.com/) with an SSH key. Use a host alias from `~/.ssh/config`, and check it once by hand:

   ```bash
   ssh my-pc
   ```

3. On the Mac, add the PC to `observatory.config.json`:

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

Within ten minutes both menus and both dashboards list both computers.

## What travels over SSH

The Mac runs two fixed commands on the PC: one reads `usage.json`, one writes `combined.incoming.json` through a temporary file and a rename, after checking its size. The PC merges that file itself, so the Mac never replaces a newer result the PC made. SSH runs in batch mode with strict host key checking and without agent, X11 or port forwarding. The files hold totals and limit readings, never prompts, messages, session names or credentials.

## If the PC is off

The Mac keeps the last copy it read and shows its age. The PC's numbers for today show Unknown, not zero, and so does any sum that includes them.
