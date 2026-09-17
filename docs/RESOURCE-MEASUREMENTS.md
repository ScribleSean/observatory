# Development resource measurements

September 13, 2026 UTC. Both installed applications were version 0.3.8, build 14, source `40d2fb7`. These are observations on one development setup, not hardware requirements or performance guarantees.

## Observed collection windows

| Platform | Observation window UTC | Samples | Largest sampled process tree | Largest sampled memory sum | Final native-process memory |
| --- | --- | ---: | ---: | ---: | ---: |
| Mac ARM64 | 08:49:59 to 08:55:31 | 67 | 5 processes | 306,380,800 bytes RSS (292 MiB) | 113,983,488 bytes RSS (109 MiB) |
| Windows x64 | 08:50:10 to 08:55:57 | 67 | 5 processes | 172,806,144 bytes working set (165 MiB) | 48,726,016 bytes working set (46 MiB) |

The samplers read process identifiers, parent identifiers and memory counters, then summed the installed application's process tree. They waited five seconds between reads. Query overhead made the actual intervals slightly longer, particularly on Windows. The windows included normal scheduled collection, without a manual refresh, application replacement, sleep or logout. Saved collection status reported success during the observation windows.

Both applications returned to one observed native process after collection. This does not establish leak freedom or a long-running idle baseline.

## Build 24 Mac observation, September 17

The installed Mac candidate from `73d1145` was sampled 73 times at five-second
intervals from 22:06:32 to 22:12:33 UTC. The largest observed descendant tree had
four processes and summed RSS of 285,786,112 bytes, about 273 MiB. At the final
sample only the native process remained, using 55,132,160 bytes RSS, about 53 MiB.
The native process accumulated 0.47 CPU seconds across the 360-second window.
That CPU counter excludes collector helpers and independent source services.

The window included scheduled collection. One observed collection completed
partially, reading 11 of 13 configured sources. Resource measurements do not
establish complete source health. No manual refresh, sleep or logout was used.
Short-lived helpers may fall between samples, shared pages may be counted more
than once, and this development-machine observation is not a controlled benchmark
or evidence of leak freedom.

## Build 25 Mac observation, September 17

The installed 0.3.13 build 25 from clean source `53fa934` was sampled 73 times at
five-second intervals from 23:22:28 to 23:28:28 UTC. The largest observed descendant
tree had four processes and summed RSS of 304,807,936 bytes, about 291 MiB. The
final sample contained one native process using 64,651,264 bytes RSS, about 62 MiB.
Its CPU counter increased by 0.63 seconds over the six-minute window. That counter
excludes collector helpers and independent source services.

The first collection was already running when sampling began. It and the next
scheduled collection completed successfully with 13 of 13 configured source reads.
The app returned to one observed native process after collection. No manual
refresh, application replacement, sleep or logout was used. This observation
includes the retained-history reader introduced in build 25, but does not measure
cold-cache scanning or prove complete historical capture. It is not a controlled
comparison with build 24 or a long-running leak test.

## Limits

- Processes that started and exited between samples can be missed. These are observed peaks, not maximum memory bounds.
- Independent ActivityWatch processes, the WSL VM, other source applications and helpers outside the descendant tree are excluded.
- Summed RSS or working sets can count shared pages more than once. They are not measurements of unique physical memory or directly interchangeable platform metrics.
- Normal development work continued on the machines. This was not a controlled benchmark, and sampler overhead is not included in the application totals.
- CPU during collection, energy use, long-running growth, larger histories, clean-machine behavior and sleep/wake resource recovery remain unverified.

The [release checklist](RELEASE-CHECKLIST.md) retains these open performance gates. Installer file sizes are separate from runtime memory.
