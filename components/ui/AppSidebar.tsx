'use client';
import Link from 'next/link';
import {BookOpen,CalendarDays,Compass,House,Map,NotebookPen,PanelLeftClose,PanelLeftOpen,Settings,Sunrise} from 'lucide-react';
import {appTabs,type AppTab} from '@/lib/frontend/navigation';
const icons={plan:CalendarDays,today:Sunrise,home:House,act:Compass};
export default function AppSidebar({active,collapsed,onCollapse,href,onNavigate,journalHref,mapHref,learnHref,settingsHref}:{active:AppTab|null;collapsed:boolean;onCollapse:()=>void;href:(tab:AppTab)=>string;onNavigate:(tab:AppTab)=>void;journalHref:string;mapHref:string;learnHref:string;settingsHref:string;}){
 return <aside className="halo-app-sidebar" aria-label="HALO sidebar" data-collapsed={collapsed}>
  <div className="halo-sidebar-brand"><Link href={href('plan')} aria-label="HALO homepage" onClick={event=>{event.preventDefault();onNavigate('plan');}}><span className="halo-sidebar-mark" aria-hidden="true"/><strong>HALO</strong></Link></div>
  <nav aria-label="Desktop main navigation" className="halo-sidebar-main">{appTabs.map(tab=>{const Icon=icons[tab.key];return <Link key={tab.key} href={href(tab.key)} prefetch={false} aria-label={tab.label} title={collapsed?tab.label:undefined} aria-current={active===tab.key?'page':undefined} onClick={event=>{event.preventDefault();onNavigate(tab.key);}}><Icon size={21} aria-hidden="true"/><span>{tab.label}</span></Link>;})}</nav>
  <nav className="halo-sidebar-tools" aria-label="Your tools"><Link href={journalHref} title={collapsed?'Journal':undefined}><NotebookPen size={20} aria-hidden="true"/><span>Journal</span></Link><Link href={mapHref} title={collapsed?'Map':undefined}><Map size={20} aria-hidden="true"/><span>Map</span></Link><Link href={learnHref} title={collapsed?'Learn':undefined}><BookOpen size={20} aria-hidden="true"/><span>Learn</span></Link></nav>
  <div className="halo-sidebar-bottom"><Link href={settingsHref} title={collapsed?'Settings':undefined}><Settings size={20} aria-hidden="true"/><span>Settings</span></Link><button onClick={onCollapse} aria-label={collapsed?'Expand navigation':'Collapse navigation'} aria-expanded={!collapsed}>{collapsed?<PanelLeftOpen size={20} aria-hidden="true"/>:<PanelLeftClose size={20} aria-hidden="true"/>}<span>Collapse</span></button></div>
 </aside>;
}
