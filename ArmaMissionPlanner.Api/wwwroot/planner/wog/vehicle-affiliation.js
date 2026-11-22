// Record occupied seats and role changes. Empty vehicles retain their last crew.
export function affiliationHistory(track){
 const history=[];let previous='';
 for(const p of track){
  const crew=[...new Set(Array.isArray(p[5])?p[5]:[])];
  const roles=crew.map(id=>p[8]?.[p[5].indexOf(id)]||'');
  const key=JSON.stringify([crew,roles]);
  if(crew.length&&key!==previous)history.push([p[0],crew,roles]);
  previous=key;
 }
 return history;
}
export function affiliationAt(history,frame){
 return affiliationEntryAt(history,frame)?.[1]??null;
}
export function affiliationEntryAt(history,frame){
 let lo=0,hi=history.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(history[mid][0]<=frame)lo=mid+1;else hi=mid;}
 return lo?history[lo-1]:null;
}
