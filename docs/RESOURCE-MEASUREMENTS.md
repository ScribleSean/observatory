# Development resource measurements

September 13, 2026 UTC. Both installed applications were version 0.3.8, build 14, source `40d2fb7`. These are observations on one development setup, not hardware requirements or performance guarantees.

## Observed collection windows

| Platform | Observation window UTC | Samples | Largest sampled process tree | Largest sampled memory sum | Final native-process memory |
| --- | --- | ---: | ---: | ---: | ---: |
| Mac ARM64 | 08:49:59 to 08:55:31 | 67 | 5 processes | 306,380,800 bytes RSS (292 MiB) | 113,983,488 bytes RSS (109 MiB) |
| Windows x64 | 08:50:10 to 08:55:57 | 67 | 5 processes | 172,806,144 bytes working set (165 MiB) | 48,726,016 bytes working set (46 MiB) |

The samplers read process identifiers, parent identifiers and memory counters, then summed the installed application's process tree. They waited five seconds between reads. Query overhead made the actual intervals slightly longer, particularly on Windows. The windows included normal scheduled collection, without a manual refresh, application replacement, sleep or logout. Saved collection status reported success during the observation windows.

Both applications returned to one observed native process after collection. This does not establish leak freedom or a long-running idle baseline.

## Limits

- Processes that started and exited between samples can be missed. These are observed peaks, not maximum memory bounds.
- Independent ActivityWatch processes, the WSL VM, other source applications and helpers outside the descendant tree are excluded.
- Summed RSS or working sets can count shared pages more than once. They are not measurements of unique physical memory or directly interchangeable platform metrics.
- Normal development work continued on the machines. This was not a controlled benchmark, and sampler overhead is not included in the application totals.
- CPU during collection, energy use, long-running growth, larger histories, clean-machine behavior and sleep/wake resource recovery remain unverified.

The [release checklist](RELEASE-CHECKLIST.md) retains these open performance gates. Installer file sizes are separate from runtime memory.
