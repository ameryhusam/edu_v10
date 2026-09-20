/**
 * The colour vocabulary for the server's seven activities.
 *
 * One table, because a learner and their parent looking at the same concept
 * must see the same colour. When this lived in two components they had already
 * started to disagree.
 *
 * Five tones, not seven: REVIEW, ASSESS and PRACTISE are all consolidation of
 * material already met, and the icon and the verb tell them apart. REMEDIATE
 * and UNBLOCK get their own tones because they are the two the learner most
 * needs to distinguish — "clear up a misunderstanding" is not "a prerequisite
 * is missing", and they used to look identical.
 *
 * This maps a decision to a colour. It never makes the decision.
 */

import type { ActivityType } from './learning.api';

export type ActivityTone = 'remediate' | 'unblock' | 'learn' | 'practise' | 'advance';

export const ACTIVITY_TONE: Record<ActivityType, ActivityTone> = {
  REMEDIATE: 'remediate',
  UNBLOCK: 'unblock',
  LEARN: 'learn',
  REVIEW: 'practise',
  ASSESS: 'practise',
  PRACTISE: 'practise',
  ADVANCE: 'advance',
};

/** The solid fill of the same tone, for an icon medallion or a marker. */
export const ACTIVITY_FILL: Record<ActivityType, string> = {
  REMEDIATE: 'bg-activity-remediate',
  UNBLOCK: 'bg-activity-unblock',
  LEARN: 'bg-activity-learn',
  REVIEW: 'bg-activity-practise',
  ASSESS: 'bg-activity-practise',
  PRACTISE: 'bg-activity-practise',
  ADVANCE: 'bg-activity-advance',
};
