/**
 * The teacher's material shelf.
 *
 * Educational and remedial materials are part of a teacher's preparation, not
 * only a learner's screen: the same outline the administrator triages and the
 * author prepares, read here while preparing class material. Kinds are the
 * schema's own (قراءة، فيديو، مثال محلول…) — no second taxonomy.
 */

import { type ReactNode } from 'react';
import { ContentOutlineBrowser } from '../../features/content/content-outline-browser';

export function TeacherMaterialsPage(): ReactNode {
  return <ContentOutlineBrowser titleKey="teacherMaterials.title" subtitleKey="teacherMaterials.subtitle" />;
}
