// Mission files are initial conditions, never observations of a shot or inventory.
export function missionClock(intel={}){
 if(!Number.isFinite(intel.hour)||!Number.isFinite(intel.minute))return null;
 const minutes=((intel.hour*60+intel.minute)%1440+1440)%1440;
 return {minutes,text:String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0'),night:minutes<360||minutes>=1200};
}
// Keep the authored capture areas together, including rotated sub-zones.
export function missionDestinations(context){
 const grouped=new Map();
 for(const [index,zone] of (context?.zones||[]).entries()){
  const key=zone.sourceEditorId??'zone:'+index;
  if(!grouped.has(key))grouped.set(key,{kind:'zone',text:zone.text,bounds:[Infinity,Infinity,-Infinity,-Infinity]});
  const item=grouped.get(key),[x,y]=zone.position,[a,b]=zone.size,r=(zone.angle||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const dx=zone.shape==='ELLIPSE'?Math.hypot(a*c,b*s):Math.abs(a*c)+Math.abs(b*s),dy=zone.shape==='ELLIPSE'?Math.hypot(a*s,b*c):Math.abs(a*s)+Math.abs(b*c);
  item.bounds=[Math.min(item.bounds[0],x-dx),Math.min(item.bounds[1],y-dy),Math.max(item.bounds[2],x+dx),Math.max(item.bounds[3],y+dy)];
 }
 return {zones:[...grouped.values()].map(z=>({...z,position:[(z.bounds[0]+z.bounds[2])/2,(z.bounds[1]+z.bounds[3])/2],radius:Math.hypot(z.bounds[2]-z.bounds[0],z.bounds[3]-z.bounds[1])/2})),targets:(context?.targets||[]).map((target,index)=>({...target,kind:'target',index}))};
}
export function matchMissionEntities(entities,tracks,objects){
 const side=s=>({WEST:'west',EAST:'east',GUER:'independent',INDEPENDENT:'independent',CIV:'civilian'})[String(s).toUpperCase()]||String(s).toLowerCase();
 const candidates=new Map();
 for(const e of entities){const p=tracks[e.id]?.[0];if(!p||p[0]>2)continue;
  const rows=objects.filter(o=>o.className?.toLowerCase()===e.className?.toLowerCase()&&(e.type!=='unit'||side(o.side)===side(e.side))).map(o=>({object:o,distance:Math.hypot(p[1]-o.position[0],p[2]-o.position[2])})).sort((a,b)=>a.distance-b.distance);
  const limit=e.type==='unit'?12:25,margin=e.type==='unit'?3:8;
  if(rows[0]?.distance<=limit&&(!rows[1]||rows[1].distance-rows[0].distance>=margin))candidates.set(e.id,rows[0]);
 }
 const counts=new Map();for(const x of candidates.values())counts.set(x.object.editorId,(counts.get(x.object.editorId)||0)+1);
 return Object.fromEntries([...candidates].filter(([,v])=>counts.get(v.object.editorId)===1).map(([id,v])=>[id,{editorId:v.object.editorId,distance:Math.round(v.distance*100)/100,confidence:'class-side-initial-position',equipment:v.object.equipment||null}]));
}
export function missionAmmoEvidence(options,equipment){
 // Keep ALL config alternatives: additions do not remove default magazines,
 // and rearming or swapping equipment later is not recorded by these files.
 const mags=new Set((equipment?.magazines||[]).filter(m=>['carried','turret','pylon','loaded'].includes(m.scope)).map(m=>m.className.toLowerCase()));
 return options.flatMap(o=>(o.magazineClasses||[o.magazineClass]).filter(m=>mags.has(m.toLowerCase())).map(m=>({magazine:m,ammo:o.ammoClass,provenance:'mission-initial-candidate'})));
}
export function missionWeaponLoadout(context,weaponClass){
 const weapon=String(weaponClass||'').toLowerCase(),magazines=[],seen=new Set();let loadouts=0;
 if(!weapon)return {magazines,loadouts};
 // Editor slots preserve mission order and include slots without an OCAP binding.
 const slots=context?.initialLoadouts||Object.values(context?.entityBindings||{});
 for(const slot of slots){
  if(slot.editorId!=null){if(seen.has(slot.editorId))continue;seen.add(slot.editorId);}
  const equipment=slot.equipment||slot;
  if(!equipment.weapons?.some(w=>String(w.className).toLowerCase()===weapon))continue;
  magazines.push(...(equipment.magazines||[]));loadouts++;
 }
 return {magazines,loadouts};
}
export function dominantMissionAmmo(options,equipment,recordedAmmo=null){
 if(recordedAmmo)return null;
 const byMagazine=new Map();
 for(const o of options){if(!/^shotbullet$/i.test(o.ammo?.simulation||''))continue;
  for(const mag of o.magazineClasses||[o.magazineClass])byMagazine.set(mag.toLowerCase(),o.ammoClass);
 }
 const counts=new Map();
 for(const m of equipment?.magazines||[]){
  if(!['carried','loaded'].includes(m.scope)||!(m.count>0))continue;
  const ammo=byMagazine.get(String(m.className).toLowerCase());if(ammo)counts.set(ammo,(counts.get(ammo)||0)+m.count);
 }
 const ranked=[...counts].sort((a,b)=>b[1]-a[1]);
 if(!ranked.length)return null;
 // Map insertion order follows the initial loadout; stable sort keeps it for ties.
 return {ammo:ranked[0][0],magazines:ranked[0][1],totalMagazines:ranked.reduce((s,x)=>s+x[1],0),loadouts:equipment.loadouts||0,alternatives:ranked.map(([ammo,count])=>({ammo,count})),tieBreak:ranked[1]?.[1]===ranked[0][1]?'first-in-mission-loadouts':null,provenance:'mission-weapon-most-common-compatible-ammo',assumption:'mission-initial-weapon-ammo-not-recorded-shot-ammo'};
}
export function terrainObjectHidden(row,category,areas=[],nativeTypes={},replacementSources=[]){
 if(replacementSources.some(s=>s[0]===row[0]&&Math.hypot(s[1]-row[1],s[2]-row[2],s[3]-row[3])<.1))return true;
 const bit=nativeTypes[row[0]]??{building:1,wall:2,tree:4,bush:4,rock:8,prop:8}[category];if(!bit)return false;
 return areas.some(area=>{if(!area.hidden||!(area.mask&bit))return false;const dx=row[1]-area.position[0],dy=row[3]-area.position[1],a=area.size[0],b=area.size[1];if(Math.abs(dx)>a+b||Math.abs(dy)>a+b)return false;const angle=area.angle*Math.PI/180,x=dx*Math.cos(angle)-dy*Math.sin(angle),y=dx*Math.sin(angle)+dy*Math.cos(angle);return area.shape==='rectangle'?Math.abs(x)<=a&&Math.abs(y)<=b:(x/a)**2+(y/b)**2<=1;});
}
export function terrainOverrides(points=[],step){
 const values=new Map(points.map(p=>[Math.round(p[0]/step)+':'+Math.round(p[1]/step),p[2]]));
 return {size:values.size,affects(x,y){const ix=Math.floor(x/step),iy=Math.floor(y/step);return [[ix,iy],[ix+1,iy],[ix,iy+1],[ix+1,iy+1]].some(p=>values.has(p.join(':')));},vertex(x,y,original){return values.get(Math.round(x/step)+':'+Math.round(y/step))??original;},sample(x,y,base){
  if(!values.size)return base(x,y);const gx=x/step,gy=y/step,ix=Math.floor(gx),iy=Math.floor(gy),u=gx-ix,v=gy-iy;
  if(![[ix,iy],[ix+1,iy],[ix,iy+1],[ix+1,iy+1]].some(p=>values.has(p.join(':'))))return base(x,y);
  const h=(a,b)=>values.get(a+':'+b)??base(a*step,b*step);
  const a=h(ix,iy),b=h(ix+1,iy),c=h(ix,iy+1),d=h(ix+1,iy+1);
  return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
 }};
}
