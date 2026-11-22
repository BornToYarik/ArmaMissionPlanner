// Rays and anchor dots are a single non-interactive drawing layer. Accessible
// name buttons and object picking remain in the existing DOM/3D paths.
export class CanvasOverlay{
 constructor(host){this.host=host;this.context=host.getContext('2d',{alpha:true});this.nodes=new Map();this.used=new Set();this.width=0;this.height=0;this.ratio=1;host.setAttribute('aria-hidden','true');}
 resize(width,height){const ratio=window.devicePixelRatio||1;if(width===this.width&&height===this.height&&ratio===this.ratio)return;Object.assign(this,{width,height,ratio});this.host.width=Math.max(1,Math.round(width*ratio));this.host.height=Math.max(1,Math.round(height*ratio));}
 begin(){this.used.clear();}
 get(key,tag){this.used.add(key);let node=this.nodes.get(key);if(!node){node={tag,attributes:{},dataset:{},setAttribute(name,value){this.attributes[name]=value;}};this.nodes.set(key,node);}return node;}
 end(){
  const ctx=this.context;ctx.setTransform(this.ratio,0,0,this.ratio,0,0);ctx.clearRect(0,0,this.width,this.height);ctx.lineCap='round';
  for(const [key,node]of this.nodes){
   if(!this.used.has(key)){this.nodes.delete(key);continue;}
   const a=node.attributes,opacity=a.class==='squad-member-point'?.95:1;ctx.beginPath();
   if(node.tag==='line'){ctx.moveTo(+a.x1,+a.y1);ctx.lineTo(+a.x2,+a.y2);}
   else if(node.tag==='circle'){ctx.arc(+a.cx,+a.cy,+a.r,0,Math.PI*2);if(a.fill&&a.fill!=='none'){ctx.globalAlpha=opacity*(a['fill-opacity']===undefined?1:+a['fill-opacity']);ctx.fillStyle=a.fill;ctx.fill();}}
   if(a.stroke&&a.stroke!=='none'){ctx.globalAlpha=opacity*(a['stroke-opacity']===undefined?1:+a['stroke-opacity']);ctx.strokeStyle=a.stroke;ctx.lineWidth=+(a['stroke-width']||1);ctx.stroke();}
  }
  ctx.globalAlpha=1;
 }
}
