export function readCamera(params,worldSize){
 const raw=params.get('camera');if(!raw)return null;
 const parts=raw.split(',');if(parts.length!==6||parts.some(s=>!s.trim()))return null;
 const values=parts.map(Number);if(values.some(n=>!Number.isFinite(n)||Math.abs(n)>worldSize*5))return null;
 if(Math.hypot(...values.slice(0,3).map((n,i)=>n-values[i+3]))<3)return null;
 return {position:values.slice(0,3),target:values.slice(3)};
}
export function viewUrl(href,state){
 const url=new URL(href),p=url.searchParams;
 for(const [key,value]of Object.entries({replay:state.replay,frame:state.frame.toFixed(3),side:state.side,lang:state.language,camera:[...state.position,...state.target].map(n=>n.toFixed(3)).join(','),panel:state.panel||'none',group:state.clusterOpen?'1':'0',trail:state.trail?'1':'0',solo:state.solo?'1':'0',squad:state.squad.join(','),entity:state.entity,follow:state.follow?'1':'0'})){
  if(value===null||value===undefined||value==='')p.delete(key);else p.set(key,String(value));
 }
 return url;
}
export function squadMembers(ids,entities){
 const units=ids.map(id=>entities.get(id)).filter(Boolean);
 const first=units[0];
 if(!first||first.type!=='unit'||!first.group||units.some(e=>e.type!=='unit'||e.group!==first.group||e.side!==first.side))return [];
 return [...entities.values()].filter(e=>e.type==='unit'&&e.group===first.group&&e.side===first.side).map(e=>e.id);
}
export function labelInSquad(id,position,ids){return !ids||ids.has(id)||(Array.isArray(position?.[5])&&position[5].some(id=>ids.has(id)));}
