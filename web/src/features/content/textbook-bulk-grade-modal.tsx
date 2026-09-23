/** Modal for ensuring textbook records for a complete grade. */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers3 } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import { catalogueApi as administrationApi } from '../catalogue/catalogue.api';
import { schoolsApi, type SchoolRecord } from '../schools/schools.api';
import { textbookAdministrationApi } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';

const selectClass='h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent';
export function TextbookBulkGradeModal({open,onClose,initialGradeKey,initialPart}:{readonly open:boolean;readonly onClose:()=>void;readonly initialGradeKey?:string|null;readonly initialPart?:'PART_1'|'PART_2'|null}):ReactNode{
 const {t}=useI18n(); const {schoolIds}=useSession(); const qc=useQueryClient();
 const grades=useQuery({queryKey:queryKeys.administration.catalogue('grades'),queryFn:()=>administrationApi.grades.list()}); const years=useQuery({queryKey:queryKeys.administration.catalogue('academicYears'),queryFn:()=>administrationApi.academicYears.list()}); const schools=useQuery({queryKey:queryKeys.administration.schools(),queryFn:()=>schoolsApi.list()});
 const [grade,setGrade]=useState(initialGradeKey??''); const [part,setPart]=useState<'PART_1'|'PART_2'|''>(initialPart??''); const [edition,setEdition]=useState(String(new Date().getFullYear())); const [school,setSchool]=useState(schoolIds[0]??''); const [adopt,setAdopt]=useState(false); const [summary,setSummary]=useState<string|null>(null); const current=(years.data??[]).find(y=>y.isCurrent);
 const ensure=useMutation({mutationFn:()=>{if(!part)throw new Error('Part is required');return textbookAdministrationApi.ensureForGrade({gradeKey:grade,part,edition,adopt:adopt&&school&&current?.key?{schoolKey:school,academicYearKey:current.key}:null});},onSuccess:async(r)=>{setSummary(t('textbookAdmin.ensureSummary',{created:r.created,unchanged:r.unchanged,adopted:r.adopted}));await qc.invalidateQueries({queryKey:queryKeys.textbookAdministration.all});await qc.invalidateQueries({queryKey:queryKeys.administration.all});}});
 if(!open)return null; const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();ensure.mutate();};
 return <ActionModal kind="textbook" icon={<Layers3/>} title={t('textbookAdmin.bulkSetupButton')} subtitle={t('textbookAdmin.creationHint')} onClose={onClose}
 footer={<><Button variant="ghost" type="button" disabled={ensure.isPending} onClick={onClose}>{t('common.close')}</Button><Button variant="primary" type="submit" form="textbook-bulk-form" disabled={ensure.isPending||!grade||!part}>{ensure.isPending?t('common.working'):t('textbookAdmin.ensureForGrade')}</Button></>}>
 <form id="textbook-bulk-form" onSubmit={submit} className="space-y-4">
  <ActionStepCard step={1} title={t('collection.grades')}><div className="grid gap-3 sm:grid-cols-3"><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('collection.grades')} *</span><select value={grade} onChange={e=>setGrade(e.target.value)} className={selectClass} required><option value="">—</option>{(grades.data??[]).map(g=><option key={g.key} value={g.key}>{g.name}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.physicalPart')} *</span><select value={part} onChange={e=>setPart(e.target.value as 'PART_1'|'PART_2'|'')} className={selectClass} required><option value="">—</option><option value="PART_1">{t('textbookAdmin.part1')}</option><option value="PART_2">{t('textbookAdmin.part2')}</option></select></label><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.edition')} *</span><Input value={edition} onChange={e=>setEdition(e.target.value)} required/></label></div></ActionStepCard>
  <ActionStepCard step={2} title={t('textbookAdmin.adoptCurrentYear')}><label className="flex items-center gap-2 text-xs font-medium text-text"><input type="checkbox" checked={adopt} onChange={e=>setAdopt(e.target.checked)} className="size-4 rounded border-border text-accent focus:ring-accent"/><span>{t('textbookAdmin.adoptCurrentYear')}</span></label>{adopt?<div className="space-y-2"><label className="block space-y-1.5"><span className="text-2xs font-medium text-text-muted">{t('textbookAdmin.selectSchool')}</span><select value={school} onChange={e=>setSchool(e.target.value)} className={selectClass} required><option value="">—</option>{(schools.data??[]).map((s:SchoolRecord)=><option key={s.key} value={s.key}>{s.name}</option>)}</select></label>{current?<p className="text-2xs text-text-muted">{t('textbookAdmin.selectAcademicYear')}: <span className="font-semibold text-text">{current.startsOn} – {current.endsOn}</span></p>:null}</div>:null}</ActionStepCard>
  {summary?<div className="rounded-xl border border-success/30 bg-success-subtle p-3 text-xs font-semibold text-success">{summary}</div>:null}{ensure.isError?<ErrorState error={ensure.error}/>:null}
 </form></ActionModal>;
}