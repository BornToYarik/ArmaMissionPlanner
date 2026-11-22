import * as T from './wog/vendor/three.module.js';

// Closed 3D hull, not an extrusion of a top-down footprint. Used once per plant
// model in the preparation worker; individual leaves are never ray-tested.
export function convexVolume(input){
 const unique=new Map();for(const p of input){const key=p.map(v=>Math.round(v*1000)).join(',');if(!unique.has(key))unique.set(key,new T.Vector3(...p));}
 const points=[...unique.values()];if(points.length<4)return null;
 const a=points.reduce((best,p,i)=>p.x<points[best].x?i:best,0),b=points.reduce((best,p,i)=>p.distanceToSquared(points[a])>points[best].distanceToSquared(points[a])?i:best,0),line=points[b].clone().sub(points[a]);
 if(line.lengthSq()<1e-10)return null;
 const edge=new T.Vector3(),distance=i=>edge.subVectors(points[i],points[a]).cross(line).lengthSq(),c=points.reduce((best,p,i)=>distance(i)>distance(best)?i:best,0),normal=points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a])).normalize();
 const d=points.reduce((best,p,i)=>Math.abs(normal.dot(p.clone().sub(points[a])))>Math.abs(normal.dot(points[best].clone().sub(points[a])))?i:best,0);
 if(Math.abs(normal.dot(points[d].clone().sub(points[a])))<1e-6)return null;
 const inside=points[a].clone().add(points[b]).add(points[c]).add(points[d]).multiplyScalar(.25);
 const face=(a,b,c)=>{let n=points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a]));if(n.lengthSq()<1e-12)return null;n.normalize();if(n.dot(inside.clone().sub(points[a]))>0){[b,c]=[c,b];n.negate();}return {a,b,c,n,d:n.dot(points[a])};};
 let faces=[[a,b,c],[a,c,d],[a,d,b],[b,d,c]].map(v=>face(...v));const seed=new Set([a,b,c,d]);
 for(let i=0;i<points.length;i++){
  if(seed.has(i))continue;const visible=faces.filter(f=>f.n.dot(points[i])-f.d>1e-5);if(!visible.length)continue;
  const removed=new Set(visible),edges=new Map();for(const f of visible)for(const [a,b]of [[f.a,f.b],[f.b,f.c],[f.c,f.a]]){const key=a<b?a+':'+b:b+':'+a;edges.has(key)?edges.delete(key):edges.set(key,[a,b]);}
  faces=faces.filter(f=>!removed.has(f));for(const [a,b]of edges.values()){const f=face(a,b,i);if(f)faces.push(f);}
 }
 const vertices=[];for(const f of faces)for(const i of [f.a,f.b,f.c])vertices.push(...points[i].toArray());
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.computeVertexNormals();return g;
}
