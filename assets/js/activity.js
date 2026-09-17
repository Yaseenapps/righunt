// Writing down what people ask the assistant.
//
// This never blocks a reply and never shows an error. If it cannot record a
// question, the visitor still gets their answer and nothing on screen changes
// - a broken log is not worth a broken assistant.

import { db, auth, userId } from './supabase.js';

/**
 * Record one question and what came back.
 *
 * Called after the answer is on screen, deliberately. The assistant is a
 * rules engine running against a catalogue already in memory, so it replies
 * in a few milliseconds; waiting on a round trip first would make it feel
 * slower than it is, to store something the visitor will never see.
 */
export function logQuestion(row) {
  (async () => {
    await auth();
    await db('assistant_queries', {
      method: 'POST',
      prefer: 'return=minimal',
      body: [{
        user_id: userId(),
        // The column refuses anything longer. Someone pasting an essay into
        // the box should not cost us the record of what they asked.
        asked: String(row.asked || '').slice(0, 500),
        intent: row.intent ?? null,
        category: row.category ?? null,
        budget: Number.isFinite(row.budget) ? row.budget : null,
        answered: !!row.answered,
        outcome: row.outcome ?? null,
        total: Number.isFinite(row.total) ? Math.round(row.total) : null,
        parts: row.parts ?? null,
      }],
    });
  })().catch(() => { /* offline, or the table is not there yet */ });
}
