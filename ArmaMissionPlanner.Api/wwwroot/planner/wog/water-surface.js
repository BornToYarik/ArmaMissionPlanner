// Clip sea-level triangles to the submerged part of the terrain. A full-world
// water plane can win the depth test against low land at overview distances.
export function waterSurface(terrain){
 const n=terrain.columns||terrain.resolution,rows=terrain.rows||n,half=terrain.worldSize/2,positions=[],b=terrain.bounds||[0,0,terrain.worldSize,terrain.worldSize];
 const point=(x,y)=>[b[0]+x*(b[2]-b[0])/(n-1)-half,terrain.heights[y*n+x],half-b[1]-y*(b[3]-b[1])/(rows-1)];
 function clip(triangle){
  const polygon=[];
  for(let i=0;i<3;i++){
   const a=triangle[i],b=triangle[(i+1)%3],inside=a[1]<0,next=b[1]<0;
   if(inside)polygon.push(a);
   if(inside!==next){const t=-a[1]/(b[1]-a[1]);polygon.push([a[0]+(b[0]-a[0])*t,0,a[2]+(b[2]-a[2])*t]);}
  }
  for(let i=1;i+1<polygon.length;i++)for(const p of [polygon[0],polygon[i],polygon[i+1]])positions.push(p[0],0,p[2]);
 }
 for(let y=0;y<rows-1;y++)for(let x=0;x<n-1;x++){
  const a=point(x,y),b=point(x+1,y),c=point(x,y+1),d=point(x+1,y+1);clip([a,b,c]);clip([b,d,c]);
 }
 return new Float32Array(positions);
}
