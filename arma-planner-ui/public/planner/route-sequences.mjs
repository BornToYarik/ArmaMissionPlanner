const membership=ids=>JSON.stringify([...new Set(ids)].sort((a,b)=>String(a).localeCompare(String(b))));
// A sequence belongs to a travelling group. Splitting or joining creates a new
// sequence; changing the UI selection does not. Persist IDs before route edits.
export function ensureRouteSequences(routes){
 const latest=new Map();
 for(const r of routes){
  r.sequenceMembers??=[...r.units||r.segments.map(s=>s.id)];
  const key=membership(r.sequenceMembers),previous=r.sequenceMembers.map(id=>latest.get(id));
  r.sequenceId??=previous.length&&previous.every(p=>p?.key===key&&p.id===previous[0]?.id)?previous[0].id:r.id;
  for(const s of r.segments)latest.set(s.id,{key,id:r.sequenceId});
 }
 return routes;
}
export function waypointNumber(routes,route,unitId){
 return routes.slice(0,routes.indexOf(route)+1).filter(r=>r.sequenceId===route.sequenceId&&r.segments.some(s=>s.id===unitId)).length;
}
