const enabled=new URLSearchParams(location.search).has('profile');
const checkpoints=[];
const history=[],intervals=[],longTasks=[];let previousStart=0;
const percentile=(a,p)=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*p))]:0;
if(enabled&&typeof PerformanceObserver!=='undefined'){try{new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({start:Math.round(e.startTime),ms:Math.round(e.duration)});while(longTasks.length>80)longTasks.shift();}).observe({type:'longtask',buffered:true});}catch{}}
let frameStart=0,framePrevious=0,frameCount=0,frameWindow=0,frameCosts={};
export function frameCheckpoint(name,stats={}){
 if(!enabled)return;const now=performance.now();
 if(name==='start'){if(previousStart&&now-previousStart<2000)intervals.push(now-previousStart);previousStart=now;frameStart=framePrevious=now;if(!frameWindow)frameWindow=now;return;}
 frameCosts[name]=(frameCosts[name]||0)+now-framePrevious;framePrevious=now;
 if(name==='end'){frameCount++;if(now-frameWindow>=1500){const sorted=intervals.slice().sort((a,b)=>a-b),report={frameMs:{p50:+percentile(sorted,.5).toFixed(2),p95:+percentile(sorted,.95).toFixed(2),p99:+percentile(sorted,.99).toFixed(2),max:+(sorted.at(-1)||0).toFixed(2),over33:intervals.filter(n=>n>33.4).length,count:intervals.length},at:Math.round(now),longTasks:longTasks.filter(t=>t.start>=frameWindow),fps:Math.round(frameCount*1000/(now-frameWindow)),cpuMs:Object.fromEntries(Object.entries(frameCosts).map(([k,v])=>[k,+(v/frameCount).toFixed(2)])),...stats};document.documentElement.dataset.frameProfile=JSON.stringify(report);history.push(report);if(history.length>16)history.shift();document.documentElement.dataset.frameHistory=JSON.stringify(history);intervals.length=0;frameCount=0;frameCosts={};frameWindow=now;}}
}
if(enabled)performance.setResourceTimingBufferSize(5000);
export function environmentCheckpoint(name,stats={}){
 if(!enabled)return;
 const node=document.documentElement,report=JSON.parse(node.dataset.environmentProfile||'{"checkpoints":[]}');
 if(report.checkpoints.some(c=>c.name===name)&&!Object.keys(stats).length)return;
 if(!report.checkpoints.some(c=>c.name===name))report.checkpoints.push({name,ms:Math.round(performance.now())});
 const resources=performance.getEntriesByType('resource').filter(r=>new URL(r.name).pathname.includes('/environment/'));
 Object.assign(report,stats,{requests:resources.length,bytes:resources.reduce((n,r)=>n+r.encodedBodySize,0)});node.dataset.environmentProfile=JSON.stringify(report);
}
export function loadCheckpoint(name){
 if(!enabled)return;
 checkpoints.push({name,ms:Math.round(performance.now())});
 if(name==='ready'){
  const resources=performance.getEntriesByType('resource').map(r=>({file:new URL(r.name).pathname,ms:Math.round(r.duration),bytes:r.encodedBodySize,transferred:r.transferSize,cached:r.transferSize===0&&r.decodedBodySize>0,start:Math.round(r.startTime)}));
  const report=JSON.stringify({checkpoints,requests:resources.length,transferredBytes:resources.reduce((n,r)=>n+r.transferred,0),cachedResources:resources.filter(r=>r.cached).length,bytes:resources.reduce((n,r)=>n+r.bytes,0),slowest:resources.sort((a,b)=>b.ms-a.ms).slice(0,12)});
  document.documentElement.dataset.loadProfile=report;
  console.info('OCAP startup '+report);
 }
}
