import * as T from './wog/vendor/three.module.js';

const cache=new WeakMap();
// Exact heightfield triangles, accelerated by a min/max hierarchy. Unlike a
// cube-depth texel, a terrain cell's plane is never extended into another cell.
export function terrainField(mesh,blend=1){
 if(!mesh)return null;mesh.updateMatrixWorld(true);
 const geometry=mesh.geometry,key=mesh.matrixWorld.elements.join(',')+':'+blend;
 let value=cache.get(geometry);if(value?.key===key)return value;
 value?.dispose();
 const p=geometry.attributes.position,previous=geometry.attributes.terrainPrevious,n=Math.round(Math.sqrt(p.count));
 if(n*n!==p.count)throw Error('Обзор требует регулярной сетки рельефа');
 const matrix=mesh.matrixWorld,a=new T.Vector3().fromBufferAttribute(p,0).applyMatrix4(matrix),b=new T.Vector3().fromBufferAttribute(p,1).applyMatrix4(matrix),c=new T.Vector3().fromBufferAttribute(p,n).applyMatrix4(matrix),heights=new Float32Array(n*n),v=new T.Vector3();
 for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);if(previous)v.y=previous.getX(i)*(1-blend)+v.y*blend;heights[i]=v.applyMatrix4(matrix).y;}
 const cells=n-1,padded=2**Math.ceil(Math.log2(cells)),levels=Math.log2(padded),ranges=new Float32Array(padded*padded*8);
 // Upper/lower planes for each block. Flat and uniformly sloped regions can be
 // skipped as a whole, unlike height-only bounds on a kilometre-long slope.
 let width=padded,offset=0;
 for(let y=0;y<padded;y++)for(let x=0;x<padded;x++){
  const k=(y*padded+x)*4,i=y*n+x,a=heights[i],b=heights[i+1],c=heights[i+n],d=heights[i+n+1];
  if(x>=cells||y>=cells){ranges[k+2]=1e20;ranges[k+3]=-1e20;continue;}
  const sx=(b-a+d-c)*.5,sy=(c-a+d-b)*.5,base=sx*x+sy*y;
  ranges[k]=sx;ranges[k+1]=sy;ranges[k+2]=Math.min(a,b-sx,c-sy,d-sx-sy)-base;ranges[k+3]=Math.max(a,b-sx,c-sy,d-sx-sy)-base;
 }
 let span=1;
 while(width>1){const next=width/2,nextOffset=offset+width;
  for(let y=0;y<next;y++)for(let x=0;x<next;x++){
   const children=[];let sx=0,sy=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const k=((offset+y*2+dy)*padded+x*2+dx)*4;if(ranges[k+2]>ranges[k+3])continue;children.push([k,(x*2+dx)*span,(y*2+dy)*span]);sx+=ranges[k];sy+=ranges[k+1];}
   let lo=1e20,hi=-1e20;sx/=children.length||1;sy/=children.length||1;
   for(const [k,cx,cy]of children){const dx=ranges[k]-sx,dy=ranges[k+1]-sy;for(const px of [cx,cx+span])for(const py of [cy,cy+span]){const adjust=dx*px+dy*py;lo=Math.min(lo,ranges[k+2]+adjust);hi=Math.max(hi,ranges[k+3]+adjust);}}
   const k=((nextOffset+y)*padded+x)*4;ranges[k]=sx;ranges[k+1]=sy;ranges[k+2]=lo;ranges[k+3]=hi;
  }
  offset=nextOffset;width=next;span*=2;
 }
 const texture=(data,w,h,format)=>{const t=new T.DataTexture(data,w,h,format,T.FloatType);t.minFilter=t.magFilter=T.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t;};
 const heightsMap=texture(heights,n,n,T.RedFormat),rangeMap=texture(ranges,padded,padded*2,T.RGBAFormat);
 // Determine the actual cell diagonal from the mesh indices.
 let diagonal=0;const ix=geometry.index?.array;if(ix){for(let i=0;i<3;i++){const i0=ix[i],i1=ix[(i+1)%3],dx=i1%n-i0%n,dy=Math.floor(i1/n)-Math.floor(i0/n);if(dx&&dy)diagonal=dx*dy>0?1:0;}}
 value={key,heights:heightsMap,ranges:rangeMap,grid:new T.Vector4(a.x,a.z,b.x-a.x,c.z-a.z),info:new T.Vector4(n,padded,levels,diagonal),dispose(){heightsMap.dispose();rangeMap.dispose();}};
 cache.set(geometry,value);geometry.addEventListener('dispose',()=>{cache.get(geometry)?.dispose();cache.delete(geometry);});return value;
}

export const terrainTraceGLSL=`
float gridHeight(sampler2D heights,vec2 q,vec4 info){
 vec2 cell=clamp(floor(q),vec2(0.),vec2(info.x-2.)),f=clamp(q-cell,0.,1.);
 float a=texture2D(heights,(cell+.5)/info.x).r,b=texture2D(heights,(cell+vec2(1.5,.5))/info.x).r,c=texture2D(heights,(cell+vec2(.5,1.5))/info.x).r,d=texture2D(heights,(cell+1.5)/info.x).r;
 if(info.w>.5)return f.x>=f.y?a+(b-a)*f.x+(d-b)*f.y:a+(d-c)*f.x+(c-a)*f.y;
 return f.x+f.y<=1.?a+(b-a)*f.x+(c-a)*f.y:d+(c-d)*(1.-f.x)+(b-d)*(1.-f.y);
}
vec2 clipGrid(vec2 q,vec2 dq,vec2 lo,vec2 hi){
 vec2 span=vec2(0.,1.);for(int i=0;i<2;i++){if(abs(dq[i])<.0000001){if(q[i]<lo[i]||q[i]>hi[i])return vec2(1.,0.);}else{float a=(lo[i]-q[i])/dq[i],b=(hi[i]-q[i])/dq[i];span.x=max(span.x,min(a,b));span.y=min(span.y,max(a,b));}}return span;
}
float terrainBlocked(sampler2D heights,sampler2D ranges,vec4 grid,vec4 info,vec3 eye,vec3 delta,vec2 interval){
 vec2 q=(eye.xz-grid.xy)/grid.zw,dq=delta.xz/grid.zw;vec2 clip=clipGrid(q,dq,vec2(0.),vec2(info.x-1.));
 float t=max(clip.x,interval.x),end=min(clip.y,interval.y),level=info.z;
 if(t>=end)return 0.;
 for(int iteration=0;iteration<2048;iteration++){
  float span=exp2(level);vec2 cell=floor((q+dq*min(end,t+.0000001))/span);
  vec2 edge=(cell+step(vec2(0.),dq))*span;
  vec2 exitT=vec2(abs(dq.x)>.0000001?(edge.x-q.x)/dq.x:1e20,abs(dq.y)>.0000001?(edge.y-q.y)/dq.y:1e20);
  float next=min(end,min(exitT.x,exitT.y));
  if(next<=t+.00000001){t+=.0000001;if(t>=end)return 0.;continue;}
  float row=2.*info.y-2.*info.y/span;vec4 range=texture2D(ranges,(cell+vec2(.5,row+.5))/vec2(info.y,2.*info.y));
  float y0=eye.y+delta.y*t,y1=eye.y+delta.y*next;
  if(min(y0-dot(range.xy,q+dq*t),y1-dot(range.xy,q+dq*next))>=range.w-.002){t=next;level=min(level+1.,info.z);}
  else if(level>.5){level-=1.;}
  else {
   vec2 at=q+dq*t,to=q+dq*next;float startDiff=y0-gridHeight(heights,at,info),endDiff=y1-gridHeight(heights,to,info);
   if(min(startDiff,endDiff)<-.004)return 1.;
   // The line can cross the cell's diagonal between its entry and exit.
   float divisor=info.w>.5?dq.x-dq.y:dq.x+dq.y;
   float crossT=info.w>.5?(cell.x-cell.y-q.x+q.y)/divisor:(cell.x+cell.y+1.-q.x-q.y)/divisor;
   if(abs(divisor)>.0000001&&crossT>t&&crossT<next&&eye.y+delta.y*crossT-gridHeight(heights,q+dq*crossT,info)<-.004)return 1.;
   t=next;level=min(1.,info.z);
  }
  if(t>=end-.00000001)return 0.;
 }
 // Insufficient traversal budget is unknown, never a claim of visibility.
 return 1.;
}
`;
