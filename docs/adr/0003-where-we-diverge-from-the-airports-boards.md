# Where we diverge from the airports' own boards

Three places where this dashboard deliberately shows something different from
flysfo.com or flysanjose.com. Each looks like a bug when compared side by side,
so each is recorded here.

**Actuals override estimates.** flysfo renders `estimated_in_off_block_time` and
never replaces it with the actual — Avianca 562 reached the gate at 12:45 but the
site still shows 12:50. We show the actual when it exists. The two rules disagree
on about 11% of rows, concentrated in exactly the recently-landed flights
volunteers get asked about. The deciding reason is SJC: its actuals arrive inside
the status string (`Arrived 4:01 PM`) with no separate estimate field, so SJC's
column shows actuals no matter what we choose. Matching flysfo would make the same
column mean different things at the two airports.

**Sorting is by Effective time, not Scheduled.** Both airports sort by scheduled
time. Because we keep only a one-hour tail of history where they keep several,
a flight delayed from 1:10 PM to 7:52 PM would otherwise pin itself and its six
codeshares to the top of a 4:42 PM departures board. 127 rows in the sample are
in-window by Effective time but scheduled before the window opens.

**Duplicate rows are dropped.** See ADR 0002.

The general rule: match the source unless doing so would give a volunteer a worse
answer for a passenger standing in front of them.
