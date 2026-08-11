# VM Joe's 14.1 historical fixture

The source CSV preserves ten players, the final table, and 24 recorded matches with points, innings, high runs, exported targets, historical PERF, and historical GBR progression. `players.json`, `matches.json`, and `expected-final-table.json` normalize those fields without recalculating them.

Matches could finish when the assigned target was reached or at the 20-inning cap. `exportedTarget` is therefore preserved even when a score exceeds it. `actualTarget` remains `null` unless separately confirmed by the tournament director.

The exact frontend/configuration revision is unknown, so calculated GBR and PERF values are compatibility references, not proof of stable BBS behavior. Automatic pairings, effective unconfirmed targets, and the reason two players lack a Round 5 result cannot be reconstructed. The unchanged CSV under `legacy/` remains the source evidence.
