# SFO's feed is already codeshare-expanded

The SFO flight-status feed ships one record per marketing flight number, not one
per movement: 2,650 records cover 751 movements. Each record already carries the
marketing carrier in `airline`, is flagged with `is_code_share`, and embeds the
whole operating record in `original_flight`. Normalization is therefore **one feed
record to one Flight**, and the `code_shares[]` array is ignored entirely.

Expanding `code_shares[]` — the obvious reading of the API, and what our original
design said — produces 12,104 rows instead of 2,650, because every sibling record
carries the same full array. It also inverts the roles: a naive implementation
reads `airline` as the operator when it is in fact the marketing carrier.

A Flight's identity is `flight_id` + `flight_number`. `flight_id` alone is the
*operating* flight's identity and is shared across all siblings of a movement —
613 of the sample's records collide on it. That pair still leaves 24 exact
duplicate pairs in the feed, which we drop; flysfo.com renders them twice (Air
New Zealand 9056 appears back-to-back on its own departures board) and we
deliberately do not.
