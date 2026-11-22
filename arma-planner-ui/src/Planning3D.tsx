import {useRef,useEffect} from 'react';
import type {MissionInfo} from './types';
import type {SwtPlanMarker,SwtMarkerTypeDef,SwtColorDef} from './App';
import type {PlannerCommand,PlannerSnapshot} from './planning-sync';
export default function Planning3D({mission,assignments,markers,markerCatalog,colorCatalog,command,onSnapshot,onMarkers}: {mission:MissionInfo;assignments:Record<number,string>;markers:SwtPlanMarker[];markerCatalog:SwtMarkerTypeDef[];colorCatalog:SwtColorDef[];command:PlannerCommand|null;onSnapshot:(s:PlannerSnapshot)=>void;onMarkers:(m:SwtPlanMarker[])=>void}){
 const frame=useRef<HTMLIFrameElement>(null),ready=useRef(false),last=useRef(0),current=useRef({command,onSnapshot,onMarkers});current.current={command,onSnapshot,onMarkers};
 const deliver=()=>{const c=current.current.command;if(ready.current&&c&&c.id>last.current){last.current=c.id;frame.current?.contentWindow?.postMessage({type:'planning-command',command:c},location.origin);}};
 useEffect(()=>{const receive=(e:MessageEvent)=>{if(e.origin!==location.origin||e.source!==frame.current?.contentWindow)return;if(e.data?.type==='planning-ready'){ready.current=true;deliver();}else if(e.data?.type==='planning-snapshot')current.current.onSnapshot(e.data.snapshot);else if(e.data?.type==='planning-markers-edited'&&Array.isArray(e.data.markers))current.current.onMarkers(e.data.markers);};addEventListener('message',receive);return()=>removeEventListener('message',receive);},[]);
 useEffect(deliver,[command]);
 useEffect(()=>{frame.current?.contentWindow?.postMessage({type:'planning-assignments',assignments},location.origin);},[assignments]);
 useEffect(()=>{frame.current?.contentWindow?.postMessage({type:'planning-markers',markers,markerCatalog,colorCatalog},location.origin);},[markers,markerCatalog,colorCatalog]);
 return <iframe ref={frame} title="3D-планирование" src="/planner/index.html" style={{width:'100%',height:'min(900px, 85vh)',minHeight:600,border:'1px solid #334155',borderRadius:12}} onLoad={()=>{ready.current=false;frame.current?.contentWindow?.postMessage({type:'planning-mission',mission,assignments,markers,markerCatalog,colorCatalog},location.origin);}}/>;
}
