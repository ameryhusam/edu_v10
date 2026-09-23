/** Modal for editing canonical textbook metadata. */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookPen } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Textarea } from '../../design-system/ui/textarea';
import { ErrorState } from '../../design-system/patterns/data-states';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import { textbookAdministrationApi, type TextbookAdminSummary, type PublicationStatus } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';

export function TextbookEditModal({ open, onClose, textbook }: { readonly open:boolean; readonly onClose:()=>void; readonly textbook:TextbookAdminSummary|null }): ReactNode {
  if (!open || !textbook) return null;
  return <TextbookEditForm textbook={textbook} onClose={onClose} />;
}
function TextbookEditForm({ textbook, onClose }: { readonly textbook:TextbookAdminSummary; readonly onClose:()=>void }): ReactNode {
  const {t}=useI18n(); const qc=useQueryClient();
  const [title,setTitle]=useState(textbook.title); const [status,setStatus]=useState<PublicationStatus>(textbook.status ?? 'DRAFT');
  const [description,setDescription]=useState(textbook.description ?? ''); const [issuer,setIssuer]=useState(textbook.issuer ?? '');
  const [isbn,setIsbn]=useState(textbook.isbn ?? ''); const [publishYear,setPublishYear]=useState(textbook.publishYear ? String(textbook.publishYear) : '');
  const [totalPages,setTotalPages]=useState(textbook.totalPages ? String(textbook.totalPages) : '');
  const update=useMutation({mutationFn:async()=>{await textbookAdministrationApi.updateNode({kind:'textbook',key:textbook.key,patch:{title:title.trim(),description:description.trim()||null,issuer:issuer.trim()||null,isbn:isbn.trim()||null,publishYear:publishYear?Number(publishYear):null,totalPages:totalPages?Number(totalPages):null}});if(status!==textbook.status)await textbookAdministrationApi.updateTextbookStatus(textbook.key,status);},onSuccess:async()=>{await qc.invalidateQueries({queryKey:queryKeys.textbookAdministration.all});onClose();}});
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();update.mutate();};
  const part=textbook.part==='PART_1'?t('textbookAdmin.part1'):t('textbookAdmin.part2');
  return <ActionModal kind="textbook" icon={<BookPen/>} title={t('textbookAdmin.editBookTitle')} subtitle={[textbook.gradeName,textbook.subjectName,part].filter(Boolean).join(' · ')} onClose={onClose}
    footer={<><Button variant="ghost" type="button" disabled={update.isPending} onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="textbook-edit-form" disabled={update.isPending||!title.trim()}>{update.isPending?t('common.working'):t('catalogue.save')}</Button></>}>
    <form id="textbook-edit-form" onSubmit={submit} className="space-y-4">
      <ActionStepCard step={1} title={t('textbookAdmin.titleLabel')}>
        <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.titleLabel')} *</span><Input value={title} onChange={e=>setTitle(e.target.value)} required/></label><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('admin.status')}</span><select value={status} onChange={e=>setStatus(e.target.value as PublicationStatus)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text"><option value="DRAFT">{t('contentStatus.DRAFT')}</option><option value="IN_REVIEW">{t('contentStatus.IN_REVIEW')}</option><option value="PUBLISHED">{t('contentStatus.PUBLISHED')}</option><option value="ARCHIVED">{t('contentStatus.ARCHIVED')}</option></select></label></div>
      </ActionStepCard>
      <ActionStepCard step={2} title={t('textbookAdmin.bookDescription')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.issuer')}</span><Input value={issuer} onChange={e=>setIssuer(e.target.value)}/></label><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.isbn')}</span><Input value={isbn} onChange={e=>setIsbn(e.target.value)}/></label><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.publishYear')}</span><Input type="number" min="1900" max="2100" value={publishYear} onChange={e=>setPublishYear(e.target.value)}/></label><label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.totalPages')}</span><Input type="number" min="1" max="2000" value={totalPages} onChange={e=>setTotalPages(e.target.value)}/></label></div>
        <label className="block space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.bookDescription')}</span><Textarea rows={4} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      </ActionStepCard>
      {update.isError?<ErrorState error={update.error}/>:null}
    </form>
  </ActionModal>;
}