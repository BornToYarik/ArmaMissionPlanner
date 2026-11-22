// The orbit target can end up in the air after cursor-centred zoom.
// Use clearance and view angle, so navigation does not inherit that stale radius.
export function navigationDistance(position,target,groundHeight){
 const radius=Math.hypot(position.x-target.x,position.y-target.y,position.z-target.z);
 const downward=(position.y-target.y)/Math.max(.001,radius);
 return Math.max(3,Math.max(0,position.y-groundHeight)/Math.max(.15,downward));
}
