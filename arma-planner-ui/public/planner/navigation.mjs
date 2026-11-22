import {json} from './scene.mjs';
import {cell} from './core.mjs';
const pause=()=>new Promise(r=>setTimeout(r,0));
export async function makeGrid(scene,bounds,step=null,{coarse=false}={}){
  const size=scene.terrain.worldSize;step=step??Math.min(10,scene.detail.meta.cellSize);
  const x=Math.max(0,Math.floor(bounds[0]/step)*step),y=Math.max(0,Math.floor(bounds[1]/step)*step);
  const xmax=Math.min(size,bounds[2]),ymax=Math.min(size,bounds[3]);
  step=Math.max(step,Math.ceil(Math.max(xmax-x,ymax-y)/550));
  const nx=Math.ceil((xmax-x)/step)+1,ny=Math.ceil((ymax-y)/step)+1;
  const g={x,y,nx,ny,step,heights:new Float32Array(nx*ny),blocked:new Uint8Array(nx*ny),roads:new Uint8Array(nx*ny),missing:0};
  const terrainMissing=coarse?0:await scene.nativeRegion(x,y,xmax,ymax);
  if(terrainMissing)throw Error('Подробный рельеф загружен не полностью. Повторите подготовку.');
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)g.heights[j*nx+i]=scene.height(x+i*step,y+j*step);
  const env=scene.environment,span=env.world.tileSize;
  const tiles=coarse?[]:(env.buildingTiles||[]).filter(t=>(t.x+1)*span>=x&&t.x*span<=xmax&&(t.y+1)*span>=y&&t.y*span<=ymax);
  const boundsCache=new Map();
  const prepareRows=async rows=>{for(const a of rows){const meta=scene.catalog.models[a[0]];if(!['building','wall','rock'].includes(meta?.category)||boundsCache.has(a[0]))continue;if(meta.bounds){boundsCache.set(a[0],meta.bounds);continue;}try{const m=await env.model(a[0]);m.geometry.computeBoundingBox();const b=m.geometry.boundingBox;boundsCache.set(a[0],[b.min.toArray(),b.max.toArray()]);}catch{boundsCache.set(a[0],null);}}};
  const blockRow=a=>{
    const meta=scene.catalog.models[a[0]];if(!['building','wall','rock'].includes(meta?.category))return;
    const b=boundsCache.get(a[0])||meta.bounds;if(!b){g.missing++;return;}
    let loX=Infinity,loY=Infinity,hiX=-Infinity,hiY=-Infinity;
    for(const xx of [b[0][0],b[1][0]])for(const yy of [b[0][1],b[1][1]])for(const zz of [b[0][2],b[1][2]]){
      const wx=a[1]+a[4]*xx+a[5]*yy+a[6]*zz,wy=a[3]-a[10]*xx-a[11]*yy-a[12]*zz;
      loX=Math.min(loX,wx);hiX=Math.max(hiX,wx);loY=Math.min(loY,wy);hiY=Math.max(hiY,wy);
    }
    for(let j=Math.max(0,Math.floor((loY-y)/step));j<=Math.min(ny-1,Math.ceil((hiY-y)/step));j++)for(let i=Math.max(0,Math.floor((loX-x)/step));i<=Math.min(nx-1,Math.ceil((hiX-x)/step));i++)g.blocked[j*nx+i]=1;
  };
  for(const [i,tile]of tiles.entries()){scene.status(`Препятствия для маршрута: ${i+1}/${tiles.length}`);try{const rows=await env.tile(tile);await prepareRows(rows);for(const a of rows)blockRow(a);}catch{g.missing++;}await pause();}
  for(const rows of coarse?[]:env.buildingCells?.values()||[]){await prepareRows(rows);for(const row of rows)blockRow(row);}
  // Mission scenery is already loaded and shares its bounds with selection.
  for(const mesh of coarse?[]:scene.missionMeshes){mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld),lo=scene.map(b.min),hi=scene.map(b.max);
    for(let j=Math.max(0,Math.floor((hi[1]-y)/step));j<=Math.min(ny-1,Math.ceil((lo[1]-y)/step));j++)for(let i=Math.max(0,Math.floor((lo[0]-x)/step));i<=Math.min(nx-1,Math.ceil((hi[0]-x)/step));i++)g.blocked[j*nx+i]=1;
  }
  let roadMeta,base=`maps/roads/${scene.world}/`;
  try{roadMeta=await json(base+'index.json');}catch{base=`roads/${scene.world}/`;try{roadMeta=await json(base+'index.json');}catch{}}
  if(roadMeta){for(const t of roadMeta.tiles){const ts=roadMeta.tileSize;if((t[0]+1)*ts<x||t[0]*ts>xmax||(t[1]+1)*ts<y||t[1]*ts>ymax)continue;
    try{const r=await fetch(base+t[2]);if(!r.ok)throw Error();const image=await createImageBitmap(await r.blob()),cv=new OffscreenCanvas(image.width,image.height),ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data,pad=roadMeta.padding,scale=roadMeta.pixels/ts;
      // Existing road textures use south-to-north rows (flipY=false in WOG).
      // Scan source alpha, not a blurred satellite colour classifier.
      for(let py=pad;py<image.height-pad;py+=2)for(let px=pad;px<image.width-pad;px+=2)if(data[(py*image.width+px)*4+3]>100){const idx=cell(g,[t[0]*ts+(px-pad)/scale,t[1]*ts+(py-pad)/scale]);if(idx>=0)g.roads[idx]=1;}
      image.close();await pause();
    }catch{g.missing++;}}
  }
  return g;
}
