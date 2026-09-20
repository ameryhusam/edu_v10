/**
 * Settings — the map, not another drawer of toggles.
 *
 * Every setting this system actually has lives on a management surface that
 * already enforces its rules (structure, schools, people, enrolment, teaching,
 * textbooks). This page is the honest index of those surfaces, and it says
 * what does NOT exist: there is no stored system-settings table in the schema
 * and no consumer for one, so no UI is invented over it. A settings page full
 * of switches that write nowhere is a lie with a save button.
 */

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '../../design-system/ui/card';
import { PageHeader } from '../../design-system/patterns/page-header';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

interface SettingsEntry {
  readonly to: string;
  readonly titleKey: MessageKey;
  readonly descKey: MessageKey;
}

interface SettingsSection {
  readonly titleKey: MessageKey;
  readonly entries: readonly SettingsEntry[];
}

/**
 * The «الإعدادات الأساسية الخاصة بالتعليم», grouped the way the platform is
 * run: the academic foundation first, then its people, then what they teach
 * with, then the content itself. Every card still opens a surface that
 * enforces its own rules — this page remains the map, not another drawer of
 * toggles.
 */
const SECTIONS: readonly SettingsSection[] = [
  {
    titleKey: 'settings.section.academic',
    entries: [
      { to: '/admin/structure', titleKey: 'settings.academic', descKey: 'settings.academicDesc' },
      { to: '/admin/schools', titleKey: 'settings.school', descKey: 'settings.schoolDesc' },
      { to: '/admin/enrollments', titleKey: 'settings.enrollment', descKey: 'settings.enrollmentDesc' },
    ],
  },
  {
    titleKey: 'settings.section.people',
    entries: [
      { to: '/admin/users', titleKey: 'settings.usersRoles', descKey: 'settings.usersRolesDesc' },
      { to: '/admin/teachers', titleKey: 'settings.teaching', descKey: 'settings.teachingDesc' },
    ],
  },
  {
    titleKey: 'settings.section.content',
    entries: [
      { to: '/admin/textbooks', titleKey: 'settings.textbooks', descKey: 'settings.textbooksDesc' },
      { to: '/admin/content', titleKey: 'settings.contentSetup', descKey: 'settings.contentSetupDesc' },
    ],
  },
];

export function SettingsPage(): ReactNode {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <section key={section.titleKey} className="space-y-2.5">
            <h2 className="text-sm font-semibold text-text">{t(section.titleKey)}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.entries.map((entry) => (
                <Link key={entry.to} to={entry.to} className="block">
                  <Card elevation="default" interactive className="h-full">
                    <CardContent className="space-y-1.5 py-4">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-semibold text-text">{t(entry.titleKey)}</span>
                        <span className="text-xs font-medium text-accent">{t('settings.open')}</span>
                      </span>
                      <p className="text-xs leading-relaxed text-text-muted">{t(entry.descKey)}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Card elevation="flat">
        <CardContent className="space-y-1.5 py-4">
          <span className="text-sm font-semibold text-text-muted">{t('settings.system')}</span>
          <p className="text-xs leading-relaxed text-text-muted">{t('settings.systemDesc')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
