// Finish against horizontal map distance; terrain height must not change the goal radius.
export const manualGoalRadius=5;
export function appendManualPoint(points,point,target,radius=manualGoalRadius){
 const complete=Math.hypot(point[0]-target[0],point[1]-target[1])<=radius;
 const next=complete?[...target]:[...point],last=points.at(-1);
 return {complete,points:last&&Math.hypot(last[0]-next[0],last[1]-next[1])<.05?points:[...points,next]};
}
export function undoManualPoint(points){return points.slice(0,-1);}

export function sampleManualPath(points,{step,height,clear,inside=()=>true}){
 const path=[];for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-5)continue;
  if(!clear(a,b))throw Error('Нарисованный маршрут пересекает препятствие. Измените точки.');
  const n=Math.max(1,Math.ceil(length/(step/2)));for(let k=0;k<n;k++){const t=k/n,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;if(!inside([x,y]))throw Error('Маршрут выходит за подготовленную область');path.push([x,y,height(x,y)]);}
 }
 const last=points.at(-1);if(last)path.push([last[0],last[1],height(last[0],last[1])]);return path;
}
