// Sample the actual coarse mesh's vertex normals using its triangle diagonal.
// The detailed rim must shade exactly like the surface that continues outside it.
export function coarseNormalAt(terrain,normals,x,north){
 const n=terrain.resolution,size=terrain.worldSize;
 const gx=Math.max(0,Math.min(n-1,x/size*(n-1))),gy=Math.max(0,Math.min(n-1,north/size*(n-1)));
 const ix=Math.min(n-2,Math.floor(gx)),iy=Math.min(n-2,Math.floor(gy)),u=gx-ix,v=gy-iy,a=iy*n+ix;
 const ids=u+v<=1?[a,a+1,a+n]:[a+n+1,a+n,a+1],weights=u+v<=1?[1-u-v,u,v]:[u+v-1,1-u,1-v];
 const out=[0,0,0];for(let i=0;i<3;i++)for(let axis=0;axis<3;axis++)out[axis]+=normals[ids[i]*3+axis]*weights[i];
 return out;
}
export function patchWeight(x,y,box,fade,rim=0){
 const edge=Math.min(x-box[0],y-box[1],box[2]-x,box[3]-y),a=Math.max(0,Math.min(1,(edge-rim)/fade));
 return a*a*(3-2*a);
}
