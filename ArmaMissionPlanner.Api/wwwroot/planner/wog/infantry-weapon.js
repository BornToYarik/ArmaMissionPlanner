// Cosmetic generic rifle: the recordings do not contain held-weapon data.
// Keep the original textured soldier and pose its existing arms around the rifle.
export function armedInfantry(source){
 const data={...source,positions:[...source.positions],indices:[...source.indices],uvs:[...source.uvs],groups:source.groups.map(g=>({...g})),materials:[...source.materials]};
 for(let i=0;i<data.positions.length;i+=3){
  const x=data.positions[i],y=data.positions[i+1],z=data.positions[i+2],side=x<0?-1:1;
  if(Math.abs(x)<.225||y<.68||y>1.48)continue;
  const upper=y>=1.14,t=Math.max(0,Math.min(1,upper?(1.46-y)/.32:(1.14-y)/.27));
  const oldX=side*(upper?.20+.09*t:.29+.03*t);
  const shoulder=[side*.20,1.46,.07],elbow=[side*.28,1.18,-.10],hand=side>0?[.075,1.17,-.22]:[-.025,1.19,-.43];
  const a=upper?shoulder:elbow,b=upper?elbow:hand;
  data.positions[i]=a[0]+(b[0]-a[0])*t+(x-oldX);
  data.positions[i+1]=a[1]+(b[1]-a[1])*t-Math.max(0,.87-y)*.3;
  data.positions[i+2]=a[2]+(b[2]-a[2])*t+(z-.075)-Math.max(0,.87-y)*.7;
 }
 const start=data.indices.length;
 function box(cx,cy,cz,sx,sy,sz){
  const first=data.positions.length/3;
  for(const [x,y,z]of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]){data.positions.push(cx+x*sx/2,cy+y*sy/2,cz+z*sz/2);data.uvs.push(0,0);}
  for(const i of [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5])data.indices.push(first+i);
 }
 box(.025,1.22,-.29,.065,.10,.30); // Receiver.
 box(.025,1.22,-.04,.065,.10,.20); // Stock against the shoulder.
 box(.025,1.22,-.48,.065,.075,.15); // Fore-end in the support hand.
 box(.025,1.235,-.65,.025,.025,.22); // Barrel.
 box(.025,1.08,-.30,.045,.19,.07); // Magazine.
 box(.065,1.12,-.18,.045,.13,.055); // Grip in the trigger hand.
 const materialIndex=data.materials.length;
 data.materials.push({weapon:true});data.groups.push({start,count:data.indices.length-start,materialIndex});
 const rifleEnd=data.positions.length;
 // Rest pose uses the original relaxed mesh, independent of the raised weapon pose.
 const rest=[...source.positions];
 for(let i=0;i<rest.length;i+=3){
  let x=rest[i],y=rest[i+1],z=rest[i+2];const side=x<0?-1:1;
  if(Math.abs(x)>=.225&&y>=.68&&y<=1.48){
   const upper=y>=1.14,t=Math.max(0,Math.min(1,upper?(1.46-y)/.32:(1.14-y)/.27));
   const oldX=side*(upper?.20+.09*t:.29+.03*t);
   const shoulder=[side*.20,1.46,.07],elbow=[side*(side>0?.36:.39),1.13,.06],hand=[side*(side>0?.43:.48),.86,side>0?.06:.02];
   const a=upper?shoulder:elbow,b=upper?elbow:hand;
   x=a[0]+(b[0]-a[0])*t+(x-oldX);y=a[1]+(b[1]-a[1])*t-Math.max(0,.87-y)*.3;z=a[2]+(b[2]-a[2])*t+(z-.075);
  }else if(y<.86){
   const angle=side*(side>0?.10:.16),dy=y-.86;
   x=Math.cos(angle)*x-Math.sin(angle)*dy;y=.86+Math.sin(angle)*rest[i]+Math.cos(angle)*dy;
   z-=Math.sin(Math.PI*Math.max(0,Math.min(1,(.86-y)/.86)))*(side>0?.10:.04);
  }else if(y>1.50){
   const angle=.10,dy=y-1.50;
   x=Math.cos(angle)*x-Math.sin(angle)*dy;y=1.50+Math.sin(angle)*rest[i]+Math.cos(angle)*dy;
  }
  rest[i]=x;rest[i+1]=y;rest[i+2]=z;
 }
 const back=Math.max(...rest.filter((_,i)=>i%3===2));
 // Lay the same rifle beside the right hand; no extra mesh or triangles.
 for(let i=source.positions.length;i<data.positions.length;i+=3){
  const u=data.positions[i+2]+.29,v=data.positions[i+1]-1.20,angle=.25;
  rest.push(.78+u*Math.sin(angle)+v*Math.cos(angle),.82+u*Math.cos(angle)-v*Math.sin(angle),back-.025+(data.positions[i]-.025));
 }
 // Shared 40-triangle helmet shell, no texture download or extra draw object.
 const helmetStart=data.positions.length,helmetFirst=helmetStart/3,helmetIndex=data.indices.length;
 for(let ring=0;ring<3;ring++)for(let j=0;j<8;j++){
  const a=j*Math.PI/4,r=[1,.86,.45][ring],x=Math.cos(a)*.118*r,z=Math.sin(a)*.145*r-.022;
  const y=[1.705,1.80,1.865][ring]+(ring===0?Math.max(0,-Math.sin(a))*.035:0);
  data.positions.push(x,y,z);data.uvs.push(0,0);
 }
 data.positions.push(0,1.885,-.022);data.uvs.push(0,0);
 for(let ring=0;ring<2;ring++)for(let j=0;j<8;j++){
  const a=helmetFirst+ring*8+j,b=helmetFirst+ring*8+(j+1)%8,c=a+8,d=b+8;
  data.indices.push(a,c,b,b,c,d);
 }
 for(let j=0;j<8;j++)data.indices.push(helmetFirst+16+j,helmetFirst+24,helmetFirst+16+(j+1)%8);
 const helmetMaterial=data.materials.length;data.materials.push({helmet:true});data.groups.push({start:helmetIndex,count:data.indices.length-helmetIndex,materialIndex:helmetMaterial});
 for(let i=helmetStart;i<data.positions.length;i+=3){const x=data.positions[i],y=data.positions[i+1],z=data.positions[i+2],dy=y-1.50;rest.push(Math.cos(.10)*x-Math.sin(.10)*dy,1.50+Math.sin(.10)*x+Math.cos(.10)*dy,z);}
 // Walk with the stock shouldered; running keeps the existing low-ready pose.
 const aim=[...data.positions];
 for(let i=0;i<source.positions.length;i+=3){
  const x=source.positions[i],y=source.positions[i+1],z=source.positions[i+2],side=x<0?-1:1;
  if(Math.abs(x)<.225||y<.68||y>1.48)continue;
  const upper=y>=1.14,t=Math.max(0,Math.min(1,upper?(1.46-y)/.32:(1.14-y)/.27)),oldX=side*(upper?.20+.09*t:.29+.03*t);
  const shoulder=[side*.20,1.46,.07],elbow=[side*.27,1.34,-.08],hand=side>0?[.075,1.53,-.22]:[-.025,1.55,-.43],a=upper?shoulder:elbow,b=upper?elbow:hand;
  aim[i]=a[0]+(b[0]-a[0])*t+x-oldX;aim[i+1]=a[1]+(b[1]-a[1])*t-Math.max(0,.87-y)*.3;aim[i+2]=a[2]+(b[2]-a[2])*t+z-.075-Math.max(0,.87-y)*.7;
 }
 for(let i=source.positions.length;i<rifleEnd;i+=3)aim[i+1]+=.36;
 // Tuck the head toward the sights, moving its helmet with it.
 for(let i=0;i<aim.length;i+=3)if((i<source.positions.length&&source.positions[i+1]>1.53)||i>=helmetStart){const y=aim[i+1]-1.53,z=aim[i+2];aim[i+1]=1.53+Math.cos(-.18)*y-Math.sin(-.18)*z-.035;aim[i+2]=Math.sin(-.18)*y+Math.cos(-.18)*z-.025;}
 // Cosmetic suspension pose: hands on risers, relaxed bent knees, rifle slung.
 // No extra triangles; reuse the same textured mesh and one vertex attribute.
 const suspended=[...data.positions];
 for(let i=0;i<source.positions.length;i+=3){
  const x=source.positions[i],y=source.positions[i+1],z=source.positions[i+2],side=x<0?-1:1;
  if(Math.abs(x)>=.225&&y>=.68&&y<=1.48){
   const upper=y>=1.14,t=Math.max(0,Math.min(1,upper?(1.46-y)/.32:(1.14-y)/.27)),oldX=side*(upper?.20+.09*t:.29+.03*t);
   const a=upper?[side*.20,1.46,.07]:[side*.37,1.42,.07],b=upper?[side*.37,1.42,.07]:[side*.16,1.78,.07];
   suspended[i]=a[0]+(b[0]-a[0])*t+x-oldX;suspended[i+1]=a[1]+(b[1]-a[1])*t;suspended[i+2]=b[2]+z-.075;
  }else if(y<.88){
   let yy=y,zz=z;
   if(y<.54){const a=-.55,dy=y-.54,dz=z-.045;yy=.54+Math.cos(a)*dy-Math.sin(a)*dz;zz=.045+Math.sin(a)*dy+Math.cos(a)*dz;}
   const a=.4,dy=yy-.88,dz=zz-.025;suspended[i+1]=.88+Math.cos(a)*dy-Math.sin(a)*dz;suspended[i+2]=.025+Math.sin(a)*dy+Math.cos(a)*dz;
  }
 }
 for(let i=source.positions.length;i<rifleEnd;i+=3){suspended[i]=.32+data.positions[i]-.025;suspended[i+1]=1.05-(data.positions[i+2]+.29);suspended[i+2]=.13+(data.positions[i+1]-1.22);}
 data.suspendedPositions=suspended;
 data.aimPositions=aim;data.rifleRange=[source.positions.length,rifleEnd];data.helmetRange=[helmetStart,data.positions.length];
 const xs=rest.filter((_,i)=>i%3===0),ys=rest.filter((_,i)=>i%3===1),zs=rest.filter((_,i)=>i%3===2);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),minZ=Math.min(...zs),maxZ=Math.max(...zs);
 data.restPositions=rest;data.restBounds={width:maxX-minX,length:maxY-minY,center:[(minX+maxX)/2,(minY+maxY)/2],back:maxZ,thickness:maxZ-minZ};
 return data;
}
