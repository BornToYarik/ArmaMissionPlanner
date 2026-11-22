import * as T from './wog/vendor/three.module.js';
// Close enclosed apertures in individual wall planes. Do not replace a whole
// building with a box (courtyards, open doors and roof outlines stay intact).
export function windowClosures(geometry){
 const attr=geometry.attributes.position,idx=geometry.index,planes=new Map(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
 const point=i=>new T.Vector3().fromBufferAttribute(attr,idx?idx.getX(i):i);
 const key=p=>p.toArray().map(x=>Math.round(x*1000)).join(',');
 for(let i=0;i<(idx?.count||attr.count);i+=3){a.copy(point(i));b.copy(point(i+1));c.copy(point(i+2));const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();if(n.lengthSq()<.5||Math.abs(n.y)>.35)continue;
  if(n.x<-.001||Math.abs(n.x)<.001&&n.z<0)n.negate();const d=n.dot(a),pk=[...n.toArray().map(x=>Math.round(x*1000)),Math.round(d*100)].join(',');
  if(!planes.has(pk))planes.set(pk,{normal:n,edges:new Map(),vertices:new Map()});const plane=planes.get(pk),v=[a,b,c];
  for(let j=0;j<3;j++){const u=v[j],w=v[(j+1)%3],ku=key(u),kw=key(w),edge=[ku,kw].sort().join('|');plane.vertices.set(ku,u.clone());plane.vertices.set(kw,w.clone());const existing=plane.edges.get(edge);plane.edges.set(edge,existing?{...existing,count:existing.count+1}:{a:ku,b:kw,count:1});}
 }
 const vertices=[];
 for(const plane of planes.values()){
  const adjacency=new Map();for(const e of plane.edges.values())if(e.count===1){for(const [x,y]of [[e.a,e.b],[e.b,e.a]]){if(!adjacency.has(x))adjacency.set(x,[]);adjacency.get(x).push(y);}}
  const visited=new Set(),loops=[],drop=Math.abs(plane.normal.x)>Math.abs(plane.normal.z)?0:2;
  const uv=p=>drop===0?new T.Vector2(p.z,p.y):new T.Vector2(p.x,p.y);
  for(const start of adjacency.keys()){if(visited.has(start)||adjacency.get(start).length!==2)continue;let current=start,previous=null,loop=[];
   for(let k=0;k<=adjacency.size;k++){if(current===start&&loop.length>2){loops.push(loop);break;}if(visited.has(current))break;visited.add(current);loop.push(plane.vertices.get(current));const neighbors=adjacency.get(current);if(neighbors?.length!==2)break;const next=neighbors.find(x=>x!==previous);previous=current;current=next;}
  }
  const inside=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
  const projected=loops.map(loop=>loop.map(uv));
  for(let i=0;i<loops.length;i++){const loop=loops[i],poly=projected[i],xs=poly.map(p=>p.x),ys=poly.map(p=>p.y);
   if(Math.max(...xs)-Math.min(...xs)>6||Math.max(...ys)-Math.min(...ys)>5)continue;
   if(!projected.some((outer,j)=>j!==i&&inside(poly[0],outer)))continue;
   for(const tri of T.ShapeUtils.triangulateShape(poly,[]))for(const k of tri)vertices.push(...loop[k].toArray());
  }
 }
 if(!vertices.length)return null;const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));return g;
}
