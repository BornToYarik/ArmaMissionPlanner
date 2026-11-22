import {useRef,useEffect} from 'react';
import type {MissionInfo} from './types';
import type {SwtPlanMarker,SwtMarkerTypeDef} from './App';

export default function Planning3D({mission,assignments,markers,markerCatalog}: {mission: MissionInfo;assignments: Record<number,string>;markers:SwtPlanMarker[];markerCatalog:SwtMarkerTypeDef[]}) {
  const frame=useRef<HTMLIFrameElement>(null);
  useEffect(()=>{frame.current?.contentWindow?.postMessage({type:'planning-assignments',assignments},location.origin);},[assignments]);
  useEffect(()=>{frame.current?.contentWindow?.postMessage({type:'planning-markers',markers,markerCatalog},location.origin);},[markers,markerCatalog]);
  return <iframe ref={frame} title="3D-планирование" src="/planner/index.html"
    style={{width:'100%',height:'min(900px, 85vh)',minHeight:600,border:'1px solid #334155',borderRadius:12}}
    onLoad={()=>frame.current?.contentWindow?.postMessage({type:'planning-mission',mission,assignments,markers,markerCatalog},location.origin)}/>;
}
