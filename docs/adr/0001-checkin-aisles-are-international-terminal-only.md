# Check-in aisles are International Terminal only

SFO's `/api/checkins` endpoint returns a single dictionary of 168 counter numbers
mapped onto 12 aisles — that is the International Terminal's aisle map, and only
that. Flights in Terminals 1 and 2 carry their own counter numbers in the same
1–168 numeric range, so they map through the dictionary cleanly and silently
produce a wrong aisle: United 540 out of Terminal 2 resolves to "Aisles 3–4",
while flysfo.com correctly shows "T2". We therefore derive a check-in aisle
**only for departures from the International Terminal** and leave it unset
everywhere else.

Terminal 3 hides the problem rather than avoiding it — United's counters are named
`CHECK-IN POSITION 9` and `SELF SERVICE BAG DROP 12`, so none of its 459
departures match the dictionary at all. Do not read that zero-coverage as
evidence the naive mapping is safe.

The failure mode is the reason this is written down: mapping every terminal looks
correct, produces a plausible aisle for every flight, and directs domestic
passengers to the wrong building.
