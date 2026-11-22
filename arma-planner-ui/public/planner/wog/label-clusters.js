import {t,language} from './i18n.js';
import {affiliationEntryAt} from './vehicle-affiliation.js';
import {playerDisplayName} from './connection-state.js';
export const SQUAD_RADIUS=1500;
// Names retain v12 thresholds; squad rays move three more zoom steps farther in v13.
const ZOOM_STEP=180*.0018;
export const SQUAD_RAY_DISTANCE=2200*Math.exp(ZOOM_STEP);
export const CLOSE_DISTANCE=2200/Math.exp(ZOOM_STEP*5)*.5*Math.exp(ZOOM_STEP*4);
export const MEMBER_NAME_DISTANCE=4200*Math.exp(ZOOM_STEP*4);
export function withinFollowRange(position,origin){return !origin||(position.x-origin.x)**2+(position.y-origin.y)**2+(position.z-origin.z)**2<=3000**2;}
export function squadDetail(distance){return distance<=CLOSE_DISTANCE?'individual':distance<=SQUAD_RAY_DISTANCE?'rays':'marker';}
export function squadKey(p){return p.side+'|'+(p.squad||p.e?.group||'@'+p.id);}
export function squadTag(name=''){return name.match(/^\s*([\p{L}\p{N}_-]{1,24})\s*\|\s*\S/u)?.[1]||name.match(/\[([^\]]+)\]/)?.[1].trim()||null;}
const squadNames=new Map();
export function squadName(members,group=t('Squad')){
 if(!members.length)return group;
 if(members.every(e=>e.planning)&&!members.some(e=>e.planningTag))return group;
 const cacheKey=JSON.stringify([language,group,members.map(e=>e.name)]);if(squadNames.has(cacheKey))return squadNames.get(cacheKey);
 const tags=new Map();
 for(const e of members){const tag=e.planning?e.planningTag:squadTag(e.name);if(!tag)continue;const key=tag.toLocaleUpperCase('ru');const entry=tags.get(key)||{tag,count:0};entry.count++;tags.set(key,entry);}
 const max=Math.max(0,...[...tags.values()].map(t=>t.count));
 const name=!max||max*2<members.length?t('Unaffiliated'):[...tags.values()].filter(t=>t.count===max).sort((a,b)=>a.tag.localeCompare(b.tag)).map(t=>'['+t.tag+']').join(' / ');
 const result=name+' · '+group;if(squadNames.size>=512)squadNames.delete(squadNames.keys().next().value);squadNames.set(cacheKey,result);return result;
}
const vehicleNames=new WeakMap();
// Use historical boarding crews (including casualties), independent of seek order.
export function vehicleName(entity,position,entities,frame=position?.[0]??-Infinity){
 if(entity.type!=='vehicle')return playerDisplayName(entity,position,frame);
 const entry=entity.affiliationHistory?affiliationEntryAt(entity.affiliationHistory,frame):null;
 const crew=entry?.[1]||position?.[5],roles=entry?.[2]||position?.[8];
 if(!Array.isArray(crew)||!crew.length)return entity.name;
 const cached=vehicleNames.get(entity);
 if(cached?.crew===crew&&cached.roles===roles&&cached.entities===entities&&cached.language===language&&cached.base===entity.name)return cached.name;
 const members=[...new Set(crew)].map(id=>({person:entities.get(id),role:String(roles?.[crew.indexOf(id)]||'').toLowerCase(),id})).filter(m=>m.person);
 let tag=null;
 for(const role of ['driver','gunner','commander']){
  const candidates=members.filter(m=>m.role===role||(role==='gunner'&&m.role==='turret'&&entity.gunnerTurret)).sort((a,b)=>a.id-b.id);
  tag=candidates.map(m=>m.person.planning?m.person.planningTag:squadTag(m.person.name)).find(Boolean);if(tag)break;
 }
 const name=tag?'['+tag+'] · '+entity.name:squadName(members.map(m=>m.person),entity.name);
 vehicleNames.set(entity,{crew,roles,entities,language,base:entity.name,name});return name;
}
// Prefer recorded leader slots; OCAP exports do not include dynamic group leadership.
export function squadLeader(items){
 const alive=items.filter(p=>p.p?.[4]!==0),pool=alive.length?alive:items;
 const rank=p=>/soldier_sl|squad.?leader|squadleader/i.test(p.e?.className||'')?0:/soldier_tl|team.?leader|officer/i.test(p.e?.className||'')?1:2;
 return [...pool].sort((a,b)=>rank(a)-rank(b)||a.id-b.id)[0];
}
// Smooth only collision-avoidance offsets. The world anchor follows the camera immediately.
export function easeLabel(item,key,memory,dt){
 const dx=item.x-item.anchorX,dy=item.y-item.anchorY,old=memory.get(key),a=1-Math.exp(-12*Math.min(.1,dt));
 const next=old?{dx:old.dx+(dx-old.dx)*a,dy:old.dy+(dy-old.dy)*a}:{dx,dy};
 memory.set(key,next);item.x=item.anchorX+next.dx;item.y=item.anchorY+next.dy;return item;
}
export function placeMemberLabels(items,{left=8,right=1000,top=72,bottom=650,occupied=[],memory=new Map()}={}){
 const placed=[...occupied];
 for(const item of [...items].sort((a,b)=>a.id-b.id)){
  let best=null;const previous=memory.get(item.id);
  const consider=(dx,dy,preferred=false)=>{
   const x=Math.max(left+item.w/2,Math.min(right-item.w/2,item.anchorX+dx)),y=Math.max(top+item.h/2,Math.min(bottom-item.h/2,item.anchorY+dy));
   const overlaps=placed.filter(p=>Math.abs(x-p.x)<(item.w+p.w)/2+4&&Math.abs(y-p.y)<(item.h+p.h)/2+3).length;
   const edgeX=Math.max(0,Math.abs(x-item.anchorX)-item.w/2),edgeY=Math.max(0,Math.abs(y-item.anchorY)-item.h/2);
   const score=overlaps*1e7+edgeX**2+edgeY**2+.05*((x-item.anchorX)**2+(y-item.anchorY)**2)-(preferred?36:0);
   if(!best||score<best.score)best={x,y,score};
  };
  if(previous)consider(previous.dx,previous.dy,true);
  for(let ring=0;ring<=1;ring++){
   const gap=8+ring*20;
   for(const sign of [-1,1]){
    consider(0,sign*(item.h/2+gap));
    consider(sign*(item.w/2+gap),0);
    for(const dy of [-1,1])consider(sign*(item.w/2+gap),dy*(item.h/2+gap));
   }
  }
  memory.set(item.id,{dx:best.x-item.anchorX,dy:best.y-item.anchorY});
  Object.assign(item,{x:best.x,y:best.y});placed.push(item);
 }
 return items;
}
export function clusterLabels(items,{distance=0,enabled=true,width=1000,height=700,memory=new Map(),measureText=text=>text.length*6}={}){
 const far=p=>enabled&&(p.distance??distance)>CLOSE_DISTANCE;
 const infantry=p=>p.e?.type!=='vehicle';
 const groupable=p=>infantry(p);
 const squads=new Map(),spatial=[];
 for(const p of [...items].sort((a,b)=>a.id-b.id)){
  if(!enabled||!groupable(p)){spatial.push({items:[p]});continue;}
  const key=squadKey(p);if(!squads.has(key))squads.set(key,[]);squads.get(key).push(p);
 }
 for(const members of squads.values()){
  const leader=squadLeader(members),core=[];
  for(const p of members){
   const detached=p.id!==leader.id&&Math.hypot((p.wx??p.x)-(leader.wx??leader.x),(p.wz??p.y)-(leader.wz??leader.y))>=SQUAD_RADIUS;
   if(detached)spatial.push({items:[p],detached:true});else core.push(p);
  }
  if(core.length)spatial.push({items:core});
 }
 // Resolve membership before view culling. A squad switches to individuals as a whole.
 const groups=spatial.flatMap(g=>g.items.some(p=>!far(p))?g.items.map(p=>({items:[p],expanded:g.items.length>1,detached:g.detached})):g).filter(g=>g.items.some(p=>p.visible!==false));
 for(const g of groups){
  const p=g.items[0];g.kind=g.items.length>1?'squad':infantry(p)?'infantry':'vehicle';g.close=g.kind==='infantry'||!!g.detached||!!g.expanded||!far(p);g.selected=g.items.some(p=>p.selected);
  g.count=g.kind==='vehicle'?(p.crewCount??0):g.items.filter(p=>p.p?.[4]!==0).length;
  g.title=g.kind==='squad'?squadName(g.items.map(p=>p.e),p.squad||p.e?.group||t('Squad')):p.displayName||p.e?.name||'';
  const visible=g.items.filter(p=>p.visible!==false);
  g.key=g.items.map(p=>p.id).join('-');const leader=squadLeader(g.items);g.leaderId=leader.id;g.anchorX=leader.labelAnchorX??leader.x;g.anchorY=leader.labelAnchorY!=null?leader.labelAnchorY-22:leader.y;
  // Only the caption is compacted: groups, counts, selection and identities stay intact.
  const inspected=g.items.some(p=>p.inspected),overview=Math.min(...g.items.map(p=>p.distance??distance))>1200;
  g.displayTitle=g.kind==='squad'&&overview&&!g.selected&&!inspected?(g.title.startsWith('[')?g.title.split(' · ')[0]:(p.squad||p.e?.group||g.title)):g.title;
  const captionWidth=measureText(g.displayTitle),iconWidth=g.kind==='vehicle'?48:38;
  g.w=g.kind==='infantry'&&!g.close?22:Math.max(45,iconWidth+captionWidth+(g.kind==='squad'||g.kind==='vehicle'?18+measureText(String(g.count)):0));g.h=26;if(g.kind==='infantry'){const notes=[p.stationaryText,p.isolationText].filter(Boolean);for(const text of notes)g.w=Math.max(g.w,measureText(text)+10);g.h+=notes.length*18;}
 }
 for(const g of groups){
  // Dense vehicle parks benefit from the same tag-only caption as squads.
  // Names remain intact in title/ARIA/details and expand on selection.
  if(g.kind!=='vehicle'||g.selected)continue;
  let neighbors=0;for(const other of groups){if(other!==g&&Math.abs(other.anchorX-g.anchorX)<150&&Math.abs(other.anchorY-g.anchorY)<75&&++neighbors===3)break;}const crowded=neighbors>=3;
  if(crowded&&g.kind==='vehicle'&&!g.selected&&Math.min(...g.items.map(p=>p.distance??distance))>1200&&g.title.startsWith('[')){
   g.displayTitle=g.title.split(' · ')[0];g.w=48+measureText(g.displayTitle)+18+measureText(String(g.count));
  }
  if(crowded&&g.kind==='vehicle'&&!g.selected&&g.count===0&&Math.min(...g.items.map(p=>p.distance??distance))>2500&&!g.title.startsWith('[')){
   g.displayTitle='';g.w=66+measureText(String(g.count));
  }
 }
 // Anchor proximity wins over collision avoidance. Never push a marker into
 // another row or clamp it to a screen edge; that invents a displaced location.
 for(const g of groups){g.x=g.anchorX;g.y=g.anchorY;memory.delete(g.key);}
 return groups;
}
