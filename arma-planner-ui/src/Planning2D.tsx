import {shortRole} from '../public/planner/planning-units.mjs';
import './Planning2D.css';
import {unitMapIcon,normalizedHeading} from './unit-map-icons';
import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import type {MissionInfo} from './types';
import type {PlannerCommand,PlannerSnapshot,PlannerUnit} from './planning-sync';
const color=(side:string)=>({WEST:'#258dc7',EAST:'#dc5555',GUER:'#36ac74',INDEPENDENT:'#36ac74'}[side.toUpperCase()]||'#b8a84d');
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export default function Planning2D({map,mission,snapshot,assignments,side,command,onInspect}:{map:L.Map|null;mission:MissionInfo;snapshot:PlannerSnapshot|null;assignments:Record<number,string>;side:string;command:(c:Omit<PlannerCommand,'id'>)=>void;onInspect:(id:number)=>void}){
 const [native,setNative]=useState<Record<string,{gameplay?:boolean;mobility?:string;displayName?:string;sourceModel?:string;displayNames?:Record<string,string>}>>({});
 useEffect(()=>{let disposed=false;fetch('/models/planning-native-catalog.json').then(r=>r.ok?r.json():null).then(d=>{if(!disposed&&d?.parameters)setNative(d.parameters);}).catch(()=>{});return()=>{disposed=true;};},[]);
 const current=useRef({command,onInspect});current.current={command,onInspect};
 useEffect(()=>{if(!map)return;const layer=L.layerGroup().addTo(map),selected=snapshot?.selected||[];
  const units:PlannerUnit[]=snapshot?.units||[...mission.groups.flatMap(g=>g.units.map(u=>({id:u.id,point:[u.position[0],u.position[2],u.position[1]],side:g.side,name:shortRole(u.roleDescription,'ru'),groupId:g.id,groupLabel:g.callSign,mobility:'foot',vehicleClass:u.vehicleClass,heading:u.directionDegrees}))),...mission.vehicles.filter(v=>native[v.vehicleClass.toLowerCase()]?.gameplay!==false&&!/ammobox|crate|wreck|mash/i.test(v.vehicleClass)).map(v=>({id:v.id,point:[v.position[0],v.position[2],v.position[1]],side:v.side,name:native[v.vehicleClass.toLowerCase()]?.displayNames?.ru||native[v.vehicleClass.toLowerCase()]?.displayName||v.description||v.customName||v.vehicleClass,mobility:native[v.vehicleClass.toLowerCase()]?.mobility||'vehicle',vehicleClass:v.vehicleClass,heading:v.directionDegrees}))];
  const visible=(u:PlannerUnit)=>!side||u.side.toUpperCase()===side.toUpperCase()||u.mobility!=='foot'&&!['WEST','EAST','GUER','INDEPENDENT','CIV','CIVILIAN'].includes(u.side.toUpperCase());
  const icons:L.Marker[]=[];
  for(const u of units.filter(visible).filter(u=>u.carrier==null)){
   const foot=u.mobility==='foot',tag=assignments[u.id],name=(tag?'['+tag+'] · ':'')+(u.name||u.groupLabel||'Юнит'),on=selected.includes(u.id),kind=unitMapIcon(u,native[(u.vehicleClass||'').toLowerCase()]?.sourceModel),size=foot?14:22,heading=normalizedHeading(u.heading),sideColor=color(u.side);
   const riders=units.filter(p=>p.carrier===u.id).length;
   const html=`<span class="planner-unit-symbol"><i style="mask-image:url('/planner/2d-icons/${kind}.svg');-webkit-mask-image:url('/planner/2d-icons/${kind}.svg')"></i></span><span class="planner-unit-caption">${esc(name)}${riders?' · '+riders:''}</span>`;
   const icon=L.divIcon({className:'planner-unit-icon'+(on?' is-selected':''),iconSize:[size,size],iconAnchor:[size/2,size/2],html});
   const marker=L.marker([u.point[1],u.point[0]],{icon,title:name,bubblingMouseEvents:false,zIndexOffset:on?3000:foot?100:200}).addTo(layer);icons.push(marker);
   const element=marker.getElement();if(element){element.style.setProperty('--unit-color',sideColor);element.style.setProperty('--unit-heading',heading+'deg');element.dataset.unitId=String(u.id);element.dataset.icon=kind;element.setAttribute('aria-label',name);}
   marker.bindTooltip(esc(name+(foot&&u.groupLabel?' · '+u.groupLabel:'')),{className:'planner-unit-tooltip',direction:'top',offset:[0,-size/2]});
   marker.on('click',e=>{L.DomEvent.stopPropagation(e);const add=(e.originalEvent as MouseEvent).shiftKey;current.current.command({action:'select',ids:add?selected.includes(u.id)?selected.filter(id=>id!==u.id):[...selected,u.id]:[u.id]});});
   marker.on('dblclick',e=>{L.DomEvent.stopPropagation(e);if(foot){const ids=units.filter(p=>p.mobility==='foot'&&p.groupId===u.groupId&&p.side===u.side).map(p=>p.id);current.current.command({action:'select',ids});}else current.current.onInspect(u.id);});
  }
  // Keep the individual symbols at every zoom; hide overlapping captions only.
  const declutter=()=>{const boxes:{x:number;y:number;w:number}[]=[];for(const m of icons){const element=m.getElement();if(!element)continue;const p=map.latLngToContainerPoint(m.getLatLng()),w=Math.min(180,element.querySelector('.planner-unit-caption')?.textContent?.length!*6.5||50),crowded=boxes.some(b=>Math.abs(b.y-p.y)<16&&p.x<b.x+b.w&&p.x+w>b.x);element.classList.toggle('is-crowded',crowded);if(!crowded)boxes.push({x:p.x,y:p.y,w});}};
  declutter();map.on('zoomend moveend',declutter);
  for(const route of snapshot?.routes||[])if(route.points.length>1)L.polyline(route.points.map(p=>[p[1],p[0]] as [number,number]),{color:route.color,weight:4,opacity:.95}).addTo(layer);
  for(const wp of snapshot?.waypoints||[]){const icon=L.divIcon({className:'',iconSize:[150,44],iconAnchor:[75,22],html:`<div style="min-width:150px;width:max-content;font-size:12px;white-space:nowrap;color:${wp.color};background:#132333f5;padding:4px 6px;border:1px solid ${wp.color};border-radius:4px"><span>${esc(wp.title||wp.text)}</span>${wp.time?`<small style="display:block;font-size:12px;color:#e5edf4">${esc(wp.time)}</small>`:''}</div>`}),m=L.marker([wp.point[1],wp.point[0]],{icon,draggable:true,zIndexOffset:5000,riseOnHover:true,riseOffset:10000}).addTo(layer);
   m.on('dragend',()=>{const p=m.getLatLng();current.current.command({action:'move',key:wp.key,point:[p.lng,p.lat]});});m.on('contextmenu',e=>{L.DomEvent.stopPropagation(e);const b=document.createElement('button');b.textContent='Удалить вейпоинт';b.onclick=()=>{map.closePopup();current.current.command({action:'delete',key:wp.key});};L.popup().setLatLng(m.getLatLng()).setContent(b).openOn(map);});
  }
  const context=(e:L.LeafletMouseEvent)=>{if(!selected.length)return;const box=document.createElement('div');box.style.display='grid';box.style.gap='8px';for(const [mode,title] of [['road','Вейпоинт: по дорогам'],['free','Вейпоинт: самый быстрый путь'],['none','Вейпоинт: без маршрута']]){const b=document.createElement('button');b.textContent=title;b.onclick=()=>{map.closePopup();current.current.command({action:'route',ids:selected,point:[e.latlng.lng,e.latlng.lat],mode});};box.append(b);}L.popup().setLatLng(e.latlng).setContent(box).openOn(map);};map.on('contextmenu',context);
  return()=>{map.off('zoomend moveend',declutter);map.off('contextmenu',context);map.removeLayer(layer);};
 },[map,mission,snapshot,assignments,side,native]);
 return <p className="text-xs text-slate-300 mb-2" role="status">ЛКМ — выбрать юнит; Shift + ЛКМ — добавить к выбору; двойной клик по бойцу — всё отделение. ПКМ по карте — вейпоинт. Точки можно перетаскивать и удалять через ПКМ. {snapshot?.status}</p>;
}
