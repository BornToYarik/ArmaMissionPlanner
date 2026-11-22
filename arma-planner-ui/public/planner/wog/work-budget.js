// Share one small main-thread budget across concurrent asset preparations.
let deadline=0,scheduled=false,draining=false;const waiting=[];
function nextFrame(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;deadline=performance.now()+1.5;drain();});}
function drain(){
 draining=false;if(!waiting.length)return;
 if(performance.now()>=deadline){nextFrame();return;}
 draining=true;waiting.shift()();
 // Let this caller's continuation spend its budget before admitting another.
 queueMicrotask(()=>queueMicrotask(drain));
}
export function workBudget(){
 if(typeof requestAnimationFrame!=='function')return null;
 if(!waiting.length&&!draining&&performance.now()<deadline)return null;
 return new Promise(resolve=>{waiting.push(resolve);if(!draining)nextFrame();});
}
const commits=[];let commitScheduled=false,interactionUntil=0;
export function sceneryInteraction(){interactionUntil=performance.now()+1000;}
function commitFrame(){commitScheduled=false;const limit=performance.now()<interactionUntil?2:12;for(let i=0;i<limit&&commits.length;i++)commits.shift()();if(commits.length){commitScheduled=true;requestAnimationFrame(commitFrame);}}
// Texture/model downloads may finish together. Admit only two new scenery
// meshes per frame during camera interaction; initial loading can proceed faster.
export function sceneryCommit(){if(typeof requestAnimationFrame!=='function')return Promise.resolve();return new Promise(resolve=>{commits.push(resolve);if(!commitScheduled){commitScheduled=true;requestAnimationFrame(commitFrame);}});}
export async function meshNormals(vertices,indices){
 const normals=new Float32Array(vertices.length);
 for(let i=0;i<indices.length;i+=3){
  if(i%12288===0){const wait=workBudget();if(wait)await wait;}
  const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  const x=vertices[c]-vertices[b],y=vertices[c+1]-vertices[b+1],z=vertices[c+2]-vertices[b+2],u=vertices[a]-vertices[b],v=vertices[a+1]-vertices[b+1],w=vertices[a+2]-vertices[b+2];
  const nx=y*w-z*v,ny=z*u-x*w,nz=x*v-y*u;
  for(const p of [a,b,c]){normals[p]+=nx;normals[p+1]+=ny;normals[p+2]+=nz;}
 }
 for(let i=0;i<normals.length;i+=3){
  if(i%12288===0){const wait=workBudget();if(wait)await wait;}
  const length=Math.hypot(normals[i],normals[i+1],normals[i+2])||1;normals[i]/=length;normals[i+1]/=length;normals[i+2]/=length;
 }
 return normals;
}

