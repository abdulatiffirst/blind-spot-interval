# Memory and availability policies

The package is pinned to ts-fsrs 6.0.0 and explicitly selects FSRS-7. It uses `await DefaultScheduler({version:'FSRS-7',desiredRetention,enableFuzz:false,enableShortTerm:false,weights})`, `newCard({now,cardId})` and `review({card,grade,now})`. It persists the complete returned card and revlog, including `stabilityFast`, `dueAt`, `lastReviewAt`, reps, learning state, version and model weights. This is not the old v5 `fsrs().repeat()` API.

Cold-start estimates live only in the initial schedule. The FSRS card remains null until a real review. The first actual review creates a new card and grades it at the actual server timestamp. Topic UUID supplies a stable card ID. Both ratings 1 and 2 preserve their original values but map to Again; 3/4/5 map to Hard/Good/Easy. Failed reviews still update the model, while the product's recovery due date is tomorrow in the user's timezone. Normal outcomes use FSRS dueAt.

Retention is separate from memory difficulty. Raising importance changes desired retention, not the difficulty parameter. Preference changes apply to subsequent calculations. Existing history keeps its original parameters. Latest-review corrections recalculate from the saved pre-review card at the original completion instant and append an audit record. Older corrections are refused. Manual placement of the next review must be reset before correction.

The availability scheduler examines five-minute candidates whose full duration fits the local study interval, excluding past/busy times. Distance from the ideal local day ranks first, with urgency/importance breaking early/late ties and earlier times preferred within a day. A default one-day-before/two-days-after window is soft: when unavailable, the search continues up to a bounded 30-day horizon and records a reason. Recovery forbids candidates before tomorrow. No slot leaves a pending unscheduled review. Luxon handles timezone/DST arithmetic; overlap checks use absolute instants.

A missed review remains pending. Calendar moves do not invoke the memory engine. Internal time placement is finalized transactionally; connected primary-calendar availability is reconciled by the worker, so the initial preview does not promise instantaneous external availability.

The official quick-start website was inaccessible in this environment. Implementation was checked against the published v6 README, exported types, official repository README, and executable tests of the installed public API.
