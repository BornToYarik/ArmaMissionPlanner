// Map-wide density chooses the base range. Adaptive quality can reduce nature further.
export function mapObjectRange(world){
 if([2500,3500].includes(world.objectDistance))return world.objectDistance;
 if(world.biome==='arid')return 3500;
 const counts=world.sourceCounts||world.counts||{},area=Math.max(1,(world.worldSize/1000)**2);
 const trees=(counts.tree||0)/area,vegetation=((counts.tree||0)+(counts.bush||0))/area,structures=((counts.building||0)+(counts.wall||0))/area;
 // Some legacy/winter vegetation packs classify their trees as bushes.
 return trees>=1200||vegetation>=2500||(world.worldSize>=10000&&(trees>=350||vegetation>=1000))||structures>=3000?2500:3500;
}
export function natureObjectRange(world,quality){
 const base=mapObjectRange(world);
 if(typeof quality==='number')return Math.min(base,Math.max(0,quality));
 return base*(quality==='high'?1:quality==='medium'?.5:.25);
}
