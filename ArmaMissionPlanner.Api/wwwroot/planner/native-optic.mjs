// Draw the installed optic's own planar P3D geometry and UVs once on resize.
// This preserves the game's lens outline/reticle without a second WebGL context.
export async function nativeOptic(canvas,config){
 const model=config.geometry;if(!model)return false;
 const images=await Promise.all(model.materials.map(async m=>{if(!m.texture)return null;const img=new Image();img.src='/'+m.texture.replace(/^\//,'');await img.decode();return img;}));
 const draw=()=>{const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio,2);canvas.width=Math.max(1,Math.round(rect.width*ratio));canvas.height=Math.max(1,Math.round(rect.height*ratio));const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  const maskIds=[...new Set(model.triangles.filter(t=>t[3]===model.maskMaterial).flatMap(t=>t.slice(0,3)))],halfX=Math.max(...maskIds.map(i=>Math.abs(model.positions[i*3]))),halfY=Math.max(...maskIds.map(i=>Math.abs(model.positions[i*3+1]))),scale=Math.min(w/(2*halfX),h/(2*halfY));
  ctx.clearRect(0,0,w,h);
  const triangles=[...model.triangles].sort((a,b)=>(a[3]===0?0:a[3]===model.maskMaterial?1:2)-(b[3]===0?0:b[3]===model.maskMaterial?1:2));
  for(const t of triangles){const p=t.slice(0,3).map(i=>[w/2+model.positions[i*3]*scale,h/2-model.positions[i*3+1]*scale]),m=model.materials[t[3]],image=images[t[3]];ctx.save();ctx.beginPath();p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
   if(!image){ctx.fillStyle='rgb('+m.color.map(c=>Math.round(c*255)).join(',')+')';ctx.fill();ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.75;ctx.stroke();ctx.restore();continue;}
   // Overlap rasterised triangle clips by a subpixel to remove antialias seams.
   const cx=p.reduce((v,q)=>v+q[0],0)/3,cy=p.reduce((v,q)=>v+q[1],0)/3;ctx.beginPath();p.forEach(([x,y],i)=>{const d=Math.max(.001,Math.hypot(x-cx,y-cy)),k=.65/d;const xx=x+(x-cx)*k,yy=y+(y-cy)*k;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.closePath();ctx.clip();const uv=t.slice(0,3).map(i=>[model.uvs[i*2]*image.width,(1-model.uvs[i*2+1])*image.height]),[u0,v0]=uv[0],du1=uv[1][0]-u0,dv1=uv[1][1]-v0,du2=uv[2][0]-u0,dv2=uv[2][1]-v0,det=du1*dv2-du2*dv1;
   if(Math.abs(det)>1e-8){const dx1=p[1][0]-p[0][0],dx2=p[2][0]-p[0][0],dy1=p[1][1]-p[0][1],dy2=p[2][1]-p[0][1],a=(dx1*dv2-dx2*dv1)/det,c=(dx2*du1-dx1*du2)/det,b=(dy1*dv2-dy2*dv1)/det,d=(dy2*du1-dy1*du2)/det;ctx.transform(a,b,c,d,p[0][0]-a*u0-c*v0,p[0][1]-b*u0-d*v0);ctx.fillStyle=ctx.createPattern(image,'repeat');const xs=uv.map(v=>v[0]),ys=uv.map(v=>v[1]);ctx.fillRect(Math.min(...xs)-1,Math.min(...ys)-1,Math.max(...xs)-Math.min(...xs)+2,Math.max(...ys)-Math.min(...ys)+2);}
   ctx.restore();
  }
 };draw();const resize=new ResizeObserver(draw);resize.observe(canvas);return ()=>resize.disconnect();
}
export function zoomKey(e){if(e.ctrlKey||e.altKey||e.metaKey)return 0;if(['NumpadAdd','Equal'].includes(e.code)||['+','='].includes(e.key))return 1;if(['NumpadSubtract','Minus'].includes(e.code)||['-','−'].includes(e.key))return -1;return 0;}
