/**
 * A fingerprint of coaching feedback, the same on the phone and in the Edge Function: a score is
 * of the feedback with the same fingerprint, so feedback changed after it was scored is scored
 * again, and the phone can tell whether the score it shows is of the feedback it shows.
 */

export interface FingerprintedFeedback {
  strength: string;
  /** `moment:<id>` or `item:<code>`. */
  evidence: readonly string[];
  practiceCode: string | null;
  changeNote: string | null;
  technique: string | null;
  demoGiven: boolean;
  planNote: string | null;
  checkBackOn: string | null;
}

function text(value: string | null): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/** SHA-256 of the feedback's fields, as 64 hexadecimal characters. */
export async function feedbackFingerprint(feedback: FingerprintedFeedback): Promise<string> {
  const canonical = JSON.stringify([
    text(feedback.strength),
    [...feedback.evidence].sort(),
    feedback.practiceCode ?? '',
    text(feedback.changeNote),
    text(feedback.technique),
    feedback.demoGiven,
    text(feedback.planNote),
    feedback.checkBackOn ?? '',
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** An evidence entry as the fingerprint counts it. */
export function evidenceKey(entry: { moment: string } | { item: string }): string {
  return 'moment' in entry ? `moment:${entry.moment}` : `item:${entry.item}`;
}
