import {useEffect,useRef} from 'react';
import type {SwtPlanMarker,SwtMarkerTypeDef,SwtColorDef} from './App';

export default function SwtMarkerEditor({marker,catalog,colors,anchor,onDone}:{marker:Partial<SwtPlanMarker>;catalog:SwtMarkerTypeDef[];colors:SwtColorDef[];anchor:number[];onDone:(m:SwtPlanMarker|null)=>void}){
 const done=useRef(onDone);done.current=onDone;
 useEffect(()=>{
  const controller=new AbortController(),url=new URL('/planner/marker-editor.mjs',location.href).href;
  import(/* @vite-ignore */ url).then(({editPlanMarker})=>editPlanMarker(marker,catalog,colors,{anchor,signal:controller.signal})).then(m=>{if(!controller.signal.aborted)done.current(m);}).catch(error=>{console.error('Marker editor failed',error);if(!controller.signal.aborted)done.current(null);});
  return()=>controller.abort();
 },[]);
 return null;
}
