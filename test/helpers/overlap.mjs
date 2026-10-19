/**
 * Two operations of one household that overlap, the way review R1 of B04
 * Task 2b reproduced them (Ruling S14):
 *
 *   const [first, second] = await overlapAtSettle(h.db, () => tab1.change(), () => tab2.change());
 *
 * The first operation runs until its first read of the household's pending
 * list (listUnresolvedOperations), and waits there. The second then runs whole
 * up to its own settle and waits there, so its read saw the first one pending.
 * The first goes on, sees the second pending, finishes and settles; then the
 * second settles. Both succeed, and each one's read of the ledger listed the
 * other. Before Ruling S14 each stored receipt then named the other, and a
 * client that parks a receipt's list and reconciles through GET
 * /api/operations alternated between the two for ever.
 *
 * The second operation is told apart by its claim: it is the second operation
 * id claimed while this runs. Its settle is held whatever status it settles
 * with, so a second operation that fails does not hang the test.
 */
export async function overlapAtSettle(db, first, second) {
  const realFrom = db.from;
  const claims = [];
  let listReads = 0;
  let secondCall = null;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let reached;
  const atSettle = new Promise((resolve) => { reached = resolve; });

  db.from = (name) => {
    const builder = realFrom(name);
    if (name !== 'operations') return builder;
    const state = { claim: null, update: null, id: null, pendingList: false };
    const upsert = builder.upsert.bind(builder);
    builder.upsert = (row, ...rest) => { state.claim = row?.operation_id ?? null; return upsert(row, ...rest); };
    const update = builder.update.bind(builder);
    builder.update = (values, ...rest) => { state.update = values; return update(values, ...rest); };
    const eq = builder.eq.bind(builder);
    builder.eq = (column, value) => {
      if (column === 'operation_id') state.id = value;
      if (column === 'status' && value === 'pending') state.pendingList = true;
      return eq(column, value);
    };
    const then = builder.then.bind(builder);
    builder.then = (ok, ko) => {
      if (state.claim) claims.push(state.claim);
      // The second operation's settle waits until the first has settled.
      if (state.update && state.update.status !== 'pending' && claims[1] && state.id === claims[1]) {
        reached();
        return gate.then(() => then(ok, ko));
      }
      // The first operation's read of the pending list waits for the second to reach its settle.
      if (state.pendingList && !state.update && (listReads += 1) === 1) {
        secondCall = second();
        return atSettle.then(() => then(ok, ko));
      }
      return then(ok, ko);
    };
    return builder;
  };

  try {
    const one = await first();
    release();
    return [one, await secondCall];
  } finally {
    db.from = realFrom;
  }
}
