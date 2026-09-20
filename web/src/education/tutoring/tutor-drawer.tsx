/**
 * In-lesson tutor drawer.
 *
 * The drawer is a client for `/tutoring/ask`; it never calls an AI provider and
 * never invents citations. The backend spends quota, retrieves lesson context,
 * checks grounding, and may refuse. This component only keeps the conversation
 * visible beside the reading.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bot, Send, X } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { Field } from '../../design-system/ui/field';
import { tutoringApi, type AskTutorResponse } from './tutoring.api';
import { useI18n } from '../../shared/i18n/i18n';

export interface TutorDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly textbookKey: string;
  readonly lessonKey: string;
  readonly conceptKey: string | null;
}

interface TutorMessage {
  readonly role: 'learner' | 'tutor';
  readonly text: string;
  readonly response?: AskTutorResponse | undefined;
}

export function TutorDrawer({
  open,
  onClose,
  textbookKey,
  lessonKey,
  conceptKey,
}: TutorDrawerProps): ReactNode {
  const { t, locale } = useI18n();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<TutorMessage[]>([]);

  const ask = useMutation({
    mutationFn: (prompt: string) =>
      tutoringApi.ask({
        question: prompt,
        textbookKey,
        lessonKey,
        ...(conceptKey ? { conceptKey } : {}),
        language: locale === 'ar' ? 'ar' : 'en',
      }),
    onSuccess: (response, prompt) => {
      setMessages((current) => [
        ...current,
        { role: 'learner', text: prompt },
        { role: 'tutor', text: response.answer, response },
      ]);
      setQuestion('');
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = question.trim();
    if (prompt.length < 3 || ask.isPending) return;
    ask.mutate(prompt);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/30" role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-tutor-title"
        className="ms-auto flex h-full w-full max-w-md flex-col border-s border-border bg-surface shadow-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 id="lesson-tutor-title" className="flex items-center gap-2 text-base font-bold">
              <Bot className="size-5" aria-hidden="true" />
              {t('tutor.drawerTitle')}
            </h2>
            <p className="text-2xs text-text-muted">{t('tutor.drawerSubtitle')}</p>
          </div>
          <Button variant="ghost" size="iconSm" onClick={onClose} aria-label={t('common.close')}>
            <X aria-hidden="true" />
          </Button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <Card elevation="flat">
              <CardContent>
                <p className="text-sm leading-relaxed text-text-muted">{t('tutor.empty')}</p>
              </CardContent>
            </Card>
          ) : (
            messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={
                  message.role === 'learner'
                    ? 'ms-auto max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-sm text-text-on-accent'
                    : 'me-auto max-w-[92%] rounded-2xl border border-border bg-surface-raised px-3 py-2 text-sm text-text'
                }
              >
                <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                {message.response?.citations.length ? (
                  <ul className="mt-2 space-y-1 border-t border-border pt-2 text-2xs text-text-muted">
                    {message.response.citations.map((citation) => (
                      <li key={citation.chunkId}>{citation.label}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))
          )}
          {ask.isError ? (
            <p role="alert" className="rounded-lg bg-danger-subtle p-3 text-xs text-danger">
              {ask.error.message}
            </p>
          ) : null}
        </div>

        <form className="space-y-3 border-t border-border p-4" onSubmit={submit}>
          <Field label={t('tutor.questionLabel')}>
            {({ id, describedBy, invalid }) => (
              <textarea
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                className="min-h-24 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={t('tutor.questionPlaceholder')}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            block
            disabled={question.trim().length < 3 || ask.isPending}
          >
            <Send aria-hidden="true" />
            {ask.isPending ? t('common.working') : t('tutor.ask')}
          </Button>
        </form>
      </aside>
    </div>
  );
}
