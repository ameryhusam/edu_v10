/** Modal for assigning published textbooks to a school context. */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { ErrorState } from '../../design-system/patterns/data-states';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import { catalogueApi as administrationApi } from '../catalogue/catalogue.api';
import { schoolsApi, type SchoolRecord } from '../schools/schools.api';
import { textbookAdministrationApi } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';

const selectClass='h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent';
export function TextbookAccreditModal({open,onClose,initialTextbookKey}:{readonly open:boolean;readonly onClose:()=>void;readonly initialTextbookKey?:string|null}):ReactNode{
 const {t}=useI18n(); const {schoolIds}=useSession(); const qc=useQueryClient();
 const [mode,setMode]=useState<'single'|'grade'>('single'); const [school,setSchool]=useState(schoolIds[0]??''); const [year,setYear]=useState(''); const [book,setBook]=useState(initialTextbookKey??''); const [grade,setGrade]=useState(''); const [message,setMessage]=useState<string|null>(null);
 const schools=useQuery({queryKey:queryKeys.administration.schools(),queryFn:()=>schoolsApi.list()});
 const years=useQuery({queryKey:queryKeys.administration.catalogue('academicYears'),queryFn:async()=>{const data=await administrationApi.academicYears.list();const current=data.find(y=>y.isCurrent);if(current&&!year)setYear(current.key);return data;}});
 const books=useQuery({queryKey:queryKeys.textbookAdministration.textbooks({limit:100}),queryFn:()=>textbookAdministrationApi.listTextbooks({limit:100})});
 const grades=useQuery({queryKey:queryKeys.administration.catalogue('grades'),queryFn:()=>administrationApi.grades.list()});
 const adopt=useMutation({mutationFn:async()=>{if(mode==='single'){await textbookAdministrationApi.adopt({schoolKey:school,academicYearKey:year,textbookKey:book});return t('textbookAdmin.accreditSuccess');}const r=await textbookAdministrationApi.adoptGrade({schoolKey:school,academicYearKey:year,gradeKey:grade});return t('textbookAdmin.accreditGradeSummary',{adopted:r.adopted,already:r.alreadyAdopted});},onSuccess:async(m)=>{setMessage(m);await qc.invalidateQueries({queryKey:queryKeys.textbookAdministration.all});await qc.invalidateQueries({queryKey:queryKeys.administration.all});}});
 if(!open)return null; const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();adopt.mutate();}; const valid=Boolean(school&&year&&(mode==='single'?book:grade));
 return <ActionModal kind="textbook" icon={<Building2/>} title={t('textbookAdmin.accreditBooks')} subtitle={t('textbookAdmin.selectSchoolHint')} onClose={onClose}
 footer={<><Button variant="ghost" type="button" disabled={adopt.isPending} onClick={onClose}>{t('common.close')}</Button><Button variant="primary" type="submit" form="textbook-adopt-form" disabled={adopt.isPending||!valid}>{adopt.isPending?t('common.working'):t('textbookAdmin.adopt')}</Button></>}>
 <form id="textbook-adopt-form" onSubmit={submit} className="space-y-4">
  <ActionStepCard step={1} title={t('textbookAdmin.accreditBooks')}><div className="flex rounded-xl border border-border bg-surface-sunken p-1"><button type="button" onClick={()=>setMode('single')} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${mode==='single'?'bg-surface-raised text-text shadow-sm':'text-text-muted'}`}>{t('textbookAdmin.modeSingleBook')}</button><button type="button" onClick={()=>setMode('grade')} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${mode==='grade'?'bg-surface-raised text-text shadow-sm':'text-text-muted'}`}>{t('textbookAdmin.modeAllGrade')}</button></div><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.selectSchool')} *</span><select value={school} onChange={e=>setSchool(e.target.value)} className={selectClass} required><option value="">—</option>{(schools.data??[]).map((s:SchoolRecord)=><option key={s.key} value={s.key}>{s.name}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.selectAcademicYear')} *</span><select value={year} onChange={e=>setYear(e.target.value)} className={selectClass} required><option value="">—</option>{(years.data??[]).map(y=><option key={y.key} value={y.key}>{y.startsOn} – {y.endsOn}{y.isCurrent?' (الحالي)':''}</option>)}</select></label></div></ActionStepCard>
  <ActionStepCard step={2} title={mode==='single'?t('textbookAdmin.selectTextbook'):t('collection.grades')}>{mode==='single'?<label className="block space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.selectTextbook')} *</span><select value={book} onChange={e=>setBook(e.target.value)} className={selectClass} required><option value="">—</option>{(books.data?.rows??[]).map(b=><option key={b.key} value={b.key}>{b.title} · {b.gradeName||b.gradeKey} · {b.subjectName||b.subjectKey}</option>)}</select></label>:<label className="block space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('collection.grades')} *</span><select value={grade} onChange={e=>setGrade(e.target.value)} className={selectClass} required><option value="">—</option>{(grades.data??[]).map(g=><option key={g.key} value={g.key}>{g.name}</option>)}</select></label>}<div className="rounded-xl border border-warning/30 bg-warning-subtle/50 p-3 text-2xs text-text-muted">{t('textbookAdmin.publishedOnlyNote')}</div></ActionStepCard>
  {message?<div className="rounded-xl border border-success/30 bg-success-subtle p-3 text-xs font-semibold text-success">{message}</div>:null}{adopt.isError?<ErrorState error={adopt.error}/>:null}
 </form></ActionModal>;
}