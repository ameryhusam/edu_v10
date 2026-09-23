import { useState, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ListTree, Download, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { LoadingState, ErrorState, EmptyState } from '../../design-system/patterns/data-states';
import { PublicationBadge } from './publication-badge';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import { textbookAdministrationApi, type TextbookSummary } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { downloadJson } from '../../shared/platform/download';

export function TextbookOutlineModal({open,onClose,textbook}:{readonly open:boolean;readonly onClose:()=>void;readonly textbook:TextbookSummary|null}):ReactNode{
 const {t}=useI18n(); const [search,setSearch]=useState(''); const [collapsed,setCollapsed]=useState<Record<string,boolean>>({});
 const key=textbook?.key??'';
 const outline=useQuery({queryKey:queryKeys.textbookAdministration.outline(key),queryFn:()=>textbookAdministrationApi.outline(key),enabled:open&&Boolean(key)});
 const units=useMemo(()=>[...(outline.data??[])].sort((a,b)=>a.orderIndex-b.orderIndex).map(u=>({...u,lessons:[...u.lessons].sort((a,b)=>a.orderIndex-b.orderIndex)})),[outline.data]);
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();if(!q)return units;return units.map(u=>{const unitMatch=u.name.toLowerCase().includes(q);const lessons=u.lessons.filter(l=>l.name.toLowerCase().includes(q)||(l.concepts??[]).some(c=>c.name.toLowerCase().includes(q)));return unitMatch?u:lessons.length?{...u,lessons}:null}).filter((u):u is (typeof units)[0]=>u!==null)},[units,search]);
 const summary=useMemo(()=>{const lessons=units.flatMap(u=>u.lessons);return {units:units.length,lessons:lessons.length,concepts:lessons.reduce((n,l)=>n+(l.conceptCount||(l.concepts?.length??0)),0)}},[units]);
 if(!open||!textbook)return null;
 const exportOutline=()=>downloadJson(`${textbook.key}_outline.json`,{schemaVersion:'1.0',exportedAt:new Date().toISOString(),textbook:{title:textbook.title,subjectName:textbook.subjectName,gradeName:textbook.gradeName,part:textbook.part,edition:textbook.edition},units});
 return <ActionModal kind="textbook" icon={<ListTree/>} title={textbook.title} subtitle={[textbook.gradeName,textbook.subjectName,textbook.part==='PART_1'?t('textbookAdmin.part1'):t('textbookAdmin.part2'),`${t('textbookAdmin.edition')} ${textbook.edition}`].filter(Boolean).join(' · ')} onClose={onClose}
 footer={<><Button variant="secondary" size="sm" onClick={exportOutline}><Download className="size-4"/>{t('content.exportPackage')}</Button><Button variant="ghost" size="sm" onClick={onClose}>{t('common.close')}</Button></>}>
 <div className="space-y-4">
  <div className="grid grid-cols-3 gap-2">{[[summary.units,t('textbookAdmin.outlineUnitsCount',{count:summary.units})],[summary.lessons,t('textbookAdmin.outlineLessonsCount',{count:summary.lessons})],[summary.concepts,t('textbookAdmin.outlineConceptsCount',{count:summary.concepts})]].map(([n,label])=><div key={String(label)} className="rounded-xl border border-border bg-surface-subtle p-3 text-center"><div className="text-lg font-extrabold text-text">{n}</div><div className="text-2xs text-text-muted">{label}</div></div>)}</div>
  <ActionStepCard step={1} title={t('content.filterOutline')}><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('content.filterOutline')} /></ActionStepCard>
  {outline.isPending?<LoadingState/>:outline.isError?<ErrorState error={outline.error} onRetry={()=>outline.refetch()}/>:filtered.length===0?<EmptyState title={t('content.noUnits')} body={t('content.noUnitsHint')} action={<Link to={`/admin/content?textbook=${encodeURIComponent(textbook.key)}`} onClick={onClose} className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-contrast"><BookOpen className="me-2 size-4"/>{t('textbookAdmin.openContentManager')}</Link>}/>:<div className="space-y-3">{filtered.map((unit,i)=>{const isCollapsed=collapsed[unit.key]??false;return <section key={unit.key} className="overflow-hidden rounded-xl border border-border bg-surface-raised"><button type="button" onClick={()=>setCollapsed(p=>({...p,[unit.key]:!p[unit.key]}))} className="flex w-full items-center justify-between gap-3 p-4 text-start hover:bg-surface-hover"><span className="flex min-w-0 items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-subtle text-xs font-bold text-accent">{i+1}</span><span className="min-w-0 truncate text-sm font-bold text-text">{unit.name}</span><span className="shrink-0 rounded-md border border-border bg-surface px-2 py-0.5 text-2xs text-text-muted">{unit.lessons.length} {t('content.lessons')}</span></span>{isCollapsed?<ChevronDown className="size-4 text-text-muted"/>:<ChevronUp className="size-4 text-text-muted"/>}</button>{!isCollapsed?<div className="divide-y divide-border border-t border-border">{unit.lessons.map((lesson,j)=><div key={lesson.key} className="space-y-2 p-3.5"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="text-2xs font-bold text-text-muted">{i+1}.{j+1}</span><span className="text-sm font-semibold text-text">{lesson.name}</span></div><span className="text-2xs text-text-muted">{(lesson.concepts??[]).length} {t('content.concepts')}</span></div>{(lesson.concepts??[]).length>0?<div className="flex flex-wrap gap-1.5 ps-6">{(lesson.concepts??[]).map(c=><span key={c.key} className="rounded-md border border-border bg-surface-subtle px-2 py-1 text-2xs text-text">{c.name}</span>)}</div>:null}</div>)}</div>:null}</section>})}</div>}
 </div>
 </ActionModal>;
}