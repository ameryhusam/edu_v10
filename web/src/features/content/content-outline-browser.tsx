import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Download, FileUp, Plus, Search } from 'lucide-react';
import { PageHeader } from '../../design-system/patterns/page-header';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { LoadingState, ErrorState, EmptyState } from '../../design-system/patterns/data-states';
import { QuestionLinkModal } from '../../education/authoring/question-link-modal';
import { ConceptDetailDrawer } from './concept-detail-drawer';
import { ContentNodeCreateModal, type ContentNodeCreateTarget } from './content-node-create-modal';
import { ContentNodeEditModal, type ContentNodeEditTarget } from './content-node-edit-modal';
import { ContentImportModal } from './content-import-modal';
import { TextbookResourcesModal } from './textbook-resources-modal';
import { UnitOutlineSection } from './unit-outline-section';
import { LessonMaterialsDrawer } from './lesson-materials-drawer';
import { PublicationBadge } from './publication-badge';
import { ContentMetric, ReadinessPanel } from './content-readiness-panel';
import { textbookAdministrationApi, type TextbookSummary } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { exportCurriculumPackage } from './curriculum-export';

export function ContentOutlineBrowser({ titleKey, subtitleKey }: { readonly titleKey: MessageKey; readonly subtitleKey: MessageKey }): ReactNode {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [bookKey, setBookKey] = useState(params.get('textbook') ?? '');
  const [search, setSearch] = useState('');
  const [create, setCreate] = useState<ContentNodeCreateTarget | null>(null);
  const [edit, setEdit] = useState<ContentNodeEditTarget | null>(null);
  const [lesson, setLesson] = useState<string | null>(null);
  const [concept, setConcept] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const qc = useQueryClient();

  const books = useQuery({ queryKey: queryKeys.textbookAdministration.textbooks({}), queryFn: () => textbookAdministrationApi.textbooks({}) });
  const outline = useQuery({ queryKey: queryKeys.content.outline(bookKey), queryFn: () => textbookAdministrationApi.outline(bookKey), enabled: Boolean(bookKey) });
  const readiness = useQuery({ queryKey: queryKeys.content.readiness(bookKey), queryFn: () => textbookAdministrationApi.readiness(bookKey), enabled: Boolean(bookKey) });
  const reorder = useMutation({ mutationFn: (x: {kind:'unit'|'lesson'|'concept'; parentKey:string; orderedKeys:readonly string[]}) => textbookAdministrationApi.reorder(x), onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.content.outline(bookKey)}) });

  useEffect(() => { const next = params.get('textbook') ?? ''; setBookKey(next); setSearch(''); }, [params]);
  const selected = (books.data?.rows ?? []).find((b: TextbookSummary) => b.key === bookKey);
  const units = useMemo(() => [...(outline.data ?? [])].sort((a,b) => a.orderIndex-b.orderIndex).map(u => ({...u, lessons:[...u.lessons].sort((a,b)=>a.orderIndex-b.orderIndex)})), [outline.data]);
  const filtered = useMemo(() => { const q=search.trim().toLowerCase(); if(!q)return units; return units.map(u => { const um=u.name.toLowerCase().includes(q); const lessons=u.lessons.filter(l=>l.name.toLowerCase().includes(q)||(l.concepts??[]).some(c=>c.name.toLowerCase().includes(q))); return um?u:lessons.length?{...u,lessons}:null; }).filter((u):u is (typeof units)[number] => Boolean(u)); }, [units,search]);
  const stats = useMemo(() => { const lessons=units.flatMap(u=>u.lessons); return {units:units.length,lessons:lessons.length,concepts:lessons.reduce((n,l)=>n+l.conceptCount,0),materials:lessons.reduce((n,l)=>n+l.resourceCount,0)}; }, [units]);

  if (books.isPending) return <LoadingState />;
  if (books.isError) return <ErrorState error={books.error} onRetry={() => books.refetch()} />;

  return <div className="space-y-6 pb-8">
    <PageHeader title={t(titleKey)} subtitle={t(subtitleKey)} actions={selected ? <div className="flex flex-wrap gap-2"><Button variant="primary" size="sm" onClick={() => setCreate({kind:'unit',textbookKey:selected.key,parentName:selected.title})}><Plus className="size-4"/>وحدة جديدة</Button><Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}><FileUp className="size-4"/>استيراد</Button><Button variant="ghost" size="sm" onClick={() => resourcesOpen || setResourcesOpen(true)}><BookOpen className="size-4"/>المصادر</Button></div> : null} />
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <label className="space-y-1.5"><span className="text-xs font-bold text-text">الكتاب</span><select value={bookKey} onChange={e=>{setBookKey(e.target.value);setParams(e.target.value?{textbook:e.target.value}:{});}} className="h-11 w-full rounded-xl border border-border bg-surface-subtle px-3 text-sm text-text"><option value="">اختر الكتاب</option>{(books.data?.rows??[]).map(b=><option key={b.key} value={b.key}>{b.title} · {b.gradeName} · {b.subjectName}</option>)}</select></label>
        <div className="flex items-end"><Button variant="secondary" size="sm" onClick={() => selected && exportCurriculumPackage(selected,units)} disabled={!selected}><Download className="size-4"/>تصدير</Button></div>
      </div>
    </section>
    {!selected ? <EmptyState title="اختر كتاباً للبدء" body="اعرض بنية الوحدات والدروس والمواد بعد تحديد الكتاب." /> : <><section className="rounded-2xl border border-border bg-surface p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black text-text">{selected.title}</h2><PublicationBadge status={selected.status}/></div><p className="mt-1 text-xs text-text-muted">{selected.gradeName} · {selected.subjectName} · {selected.part === 'PART_1' ? 'الجزء الأول' : 'الجزء الثاني'}</p></div><div className="flex flex-wrap gap-2"><ContentMetric label="وحدات" value={stats.units}/><ContentMetric label="دروس" value={stats.lessons}/><ContentMetric label="مفاهيم" value={stats.concepts}/><ContentMetric label="مواد" value={stats.materials}/></div></div></section>
    {readiness.isSuccess ? <ReadinessPanel ready={readiness.data.ready} issues={readiness.data.issues}/> : null}
    <section className="rounded-2xl border border-border bg-surface p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="relative min-w-0 flex-1"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"/><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث في الوحدات والدروس والمفاهيم" className="ps-9"/></div><Badge tone="neutral">{filtered.length} وحدات</Badge></div></section>
    {outline.isPending ? <LoadingState/> : outline.isError ? <ErrorState error={outline.error} onRetry={()=>outline.refetch()}/> : filtered.length === 0 ? <EmptyState title="لا توجد نتائج" body="جرّب تغيير عبارة البحث."/> : <div className="space-y-3">{filtered.map((unit,i)=><UnitOutlineSection key={unit.key} unit={unit} unitIndex={i} units={filtered} textbookKey={bookKey} reorderPending={reorder.isPending} onReorder={x=>reorder.mutate(x)} onEdit={setEdit} onCreate={setCreate} onOpenConcept={setConcept} onOpenLesson={setLesson} onLinkLesson={setLink}/>)}</div>}
    </>}
    {create ? <ContentNodeCreateModal target={create} onClose={()=>setCreate(null)}/> : null}
    {edit ? <ContentNodeEditModal target={edit} onClose={()=>setEdit(null)}/> : null}
    {concept ? <ConceptDetailDrawer conceptKey={concept} onClose={()=>setConcept(null)}/> : null}
    {link ? <QuestionLinkModal lessonKey={link} onClose={()=>setLink(null)}/> : null}
    {importOpen ? <ContentImportModal open={importOpen} onClose={()=>setImportOpen(false)} textbookKey={bookKey}/> : null}
    {resourcesOpen && selected ? <TextbookResourcesModal open={resourcesOpen} onClose={()=>setResourcesOpen(false)} textbookKey={selected.key} textbookTitle={selected.title}/> : null}
    {lesson ? <LessonMaterialsDrawer lessonKey={lesson} onClose={()=>setLesson(null)}/> : null}
  </div>;
}
