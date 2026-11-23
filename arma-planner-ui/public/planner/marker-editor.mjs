import {markerAssets} from './wog/marker-catalog.js';
// Shared 2D/3D editor based on the installed WOG SWT Markers UI.
const STORE='wog-planner-marker-menu-v1';
const ICONS=['mil_dot','o_inf','o_armor','hd_pickup','hd_warning','hd_unknown'];
const COLORS=['ColorBlue','ColorRed','ColorGreen','ColorBlack','ColorWhite','ColorYellow'];
const SIZES=[.7,1,1.3];
export function editPlanMarker(marker,catalog,colors=[],options={}){
 return new Promise(resolve=>{
  if(options.signal?.aborted){resolve(null);return;}
  let prefs={};try{prefs=JSON.parse(localStorage.getItem(STORE)||'{}');}catch{}
  const types=catalog.filter(d=>d.swtIdx>=0&&d.hasIcon!==false&&!/^(empty|emptyicon)$|_noshadow$/i.test(d.id));
  const palette=colors.length?colors:[{swtIdx:9,armaClass:'ColorBlue',hex:'#0080ff',name:'Синий'}];
  const quickTypes=ICONS.map((id,i)=>types.find(t=>t.id===(prefs.icons?.[i]||id))||types.find(t=>t.id===id)||types[0]);
  const quickColors=COLORS.map((id,i)=>palette.find(c=>c.armaClass===(prefs.colors?.[i]||id))||palette.find(c=>c.armaClass===id)||palette[0]);
  const shape=marker.swtTypeIndex<0;
  let type=types.find(t=>t.swtIdx===marker.swtTypeIndex)||types.find(t=>t.id===prefs.type)||quickTypes[0];
  let color=palette.find(c=>c.swtIdx===marker.swtColorIndex)||palette.find(c=>c.armaClass===prefs.color)||quickColors[0];
  let scale=shape?1:marker.scaleX??prefs.scale??1,angle=marker.angle??prefs.angle??0,result=null,settled=false;
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
  const button=(label,fn,cls='')=>{const b=el('button',cls,label);b.type='button';b.onclick=fn;return b;};
  const dialog=el('dialog','swt-marker-dialog'),form=el('form');form.method='dialog';dialog.append(form);
  const head=el('div','swt-marker-head',marker.id?'Изменить метку':'Новая метка');head.append(el('small','',Math.round(marker.x)+', '+Math.round(marker.y)));form.append(head);
  const icons=el('div','swt-quick-icons'),swatches=el('div','swt-quick-colors');form.append(icons,swatches);
  const entry=el('div','swt-marker-entry'),preview=button('',()=>{picker.hidden=!picker.hidden;position();},'swt-marker-preview');preview.title='Все значки и цвета';preview.setAttribute('aria-label',preview.title);
  const text=el('input');text.type='text';text.placeholder='Подпись метки';text.setAttribute('aria-label','Подпись метки');text.maxLength=200;text.value=marker.text??(prefs.rememberText?prefs.text||'':'');entry.append(preview,text);form.append(entry);
  form.append(button('Все значки и цвета',()=>{picker.hidden=!picker.hidden;position();},'swt-expand'));
  const picker=el('div','swt-picker');picker.hidden=true;const search=el('input');search.type='search';search.placeholder='Поиск значка';search.setAttribute('aria-label','Поиск значка');const grid=el('div','swt-icon-grid'),allColors=el('div','swt-all-colors');picker.append(search,grid,allColors);form.append(picker);
  const settings=el('details','swt-settings');settings.append(el('summary','','Настройки'));const sizeRow=el('div','swt-size-row');sizeRow.append(el('span','','Размер'));
  const sizeButtons=SIZES.map(s=>{const b=button(s+'×',()=>{scale=s;render();text.focus();});b.disabled=shape;sizeRow.append(b);return b;});
  const rotation=el('input');rotation.type='number';rotation.min='0';rotation.max='359';rotation.step='5';rotation.setAttribute('aria-label','Поворот');rotation.value=String(angle);rotation.onchange=()=>{angle=((Number(rotation.value)||0)%360+360)%360;render();};const rotationLabel=el('label','','Поворот °');rotationLabel.append(rotation);sizeRow.append(rotationLabel);settings.append(sizeRow);
  const rememberLabel=el('label','swt-remember'),remember=el('input');remember.type='checkbox';remember.checked=!!prefs.rememberText;rememberLabel.append(remember,document.createTextNode('Запоминать подпись'));settings.append(rememberLabel);
  const slots=el('div','swt-slots');slots.append(el('span','','Быстрые значки и цвета'));
  for(let i=0;i<6;i++){const row=el('div','swt-slot'),ts=el('select'),cs=el('select');ts.setAttribute('aria-label','Быстрый значок '+(i+1));cs.setAttribute('aria-label','Быстрый цвет '+(i+1));for(const d of types){const o=el('option','',d.name||d.id);o.value=d.id;ts.append(o);}for(const c of palette){const o=el('option','',c.name);o.value=c.armaClass;cs.append(o);}ts.value=quickTypes[i]?.id||'';cs.value=quickColors[i].armaClass;ts.onchange=()=>{quickTypes[i]=types.find(t=>t.id===ts.value);render();};cs.onchange=()=>{quickColors[i]=palette.find(c=>c.armaClass===cs.value);render();};row.append(el('span','',String(i+1)),ts,cs);slots.append(row);}settings.append(slots);form.append(settings);
  form.append(el('p','swt-help','↑ ↓ — значок · Shift + ↑ ↓ — цвет · Shift + колесо — размер'));
  const footer=el('div','swt-footer'),cancel=button('Отмена',()=>dialog.close()),save=el('button','',marker.id?'Сохранить':'Поставить');save.type='submit';save.disabled=!type&&!shape;footer.append(cancel,save);form.append(footer);
  function glyph(t){const g=el('span','swt-glyph');if(!t){g.textContent='◇';return g;}const url=markerAssets[t.id.toLowerCase()]?'/'+markerAssets[t.id.toLowerCase()]:'/api/assets/icon/'+encodeURIComponent(t.id);if(t.isFullColor){const img=el('img');img.src=url;img.alt='';g.append(img);}else{g.style.maskImage='url("'+url+'")';g.style.webkitMaskImage=g.style.maskImage;g.style.backgroundColor=color.swtIdx===0?t.defaultColorHex||'#fff':color.hex;}return g;}
  function iconButton(t){const b=button('',()=>{type=t;render();text.focus();});b.title=t.name||t.id;b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(type===t));b.append(glyph(t));b.disabled=shape;return b;}
  function colorButton(c){const b=button('',()=>{color=c;render();text.focus();});b.title=c.name;b.setAttribute('aria-label',c.name);b.setAttribute('aria-pressed',String(color===c));const chip=el('span');chip.style.background=c.hex;b.append(chip);return b;}
  function render(){icons.replaceChildren(...quickTypes.filter(Boolean).map(iconButton));swatches.replaceChildren(...quickColors.map(colorButton));preview.replaceChildren(glyph(shape?null:type));preview.firstChild.style.transform='rotate('+angle+'deg) scale('+Math.min(1.5,scale)+')';const q=search.value.toLocaleLowerCase();grid.replaceChildren(...types.filter(t=>(t.name+' '+t.id).toLocaleLowerCase().includes(q)).map(iconButton));allColors.replaceChildren(...palette.map(colorButton));sizeButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(scale===SIZES[i])));rotation.value=String(angle);}
  function position(){if(!options.anchor)return;const r=dialog.getBoundingClientRect(),[x,y]=options.anchor;dialog.style.margin='0';dialog.style.left=Math.max(8,Math.min(x+12,innerWidth-r.width-8))+'px';dialog.style.top=Math.max(8,Math.min(y-40,innerHeight-r.height-8))+'px';}
  search.oninput=render;settings.ontoggle=position;
  dialog.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key)||e.ctrlKey||e.metaKey||e.altKey||e.target.tagName==='SELECT'||e.target===search||e.target===rotation)return;e.preventDefault();e.stopPropagation();const list=e.shiftKey?quickColors:quickTypes,old=e.shiftKey?color:type,step=e.key==='ArrowUp'?1:-1,next=list[(Math.max(0,list.indexOf(old))+step+list.length)%list.length];if(e.shiftKey)color=next;else if(!shape)type=next;render();});
  dialog.addEventListener('wheel',e=>{if(!e.shiftKey||shape)return;e.preventDefault();e.stopPropagation();const i=SIZES.reduce((a,s,j)=>Math.abs(s-scale)<Math.abs(SIZES[a]-scale)?j:a,0);scale=SIZES[Math.max(0,Math.min(2,i+(e.deltaY<0?1:-1)))];render();},{passive:false});
  form.onsubmit=e=>{e.preventDefault();if(!type&&!shape)return;result={...marker,id:marker.id||crypto.randomUUID(),text:text.value,x:marker.x,y:marker.y,swtTypeIndex:shape?marker.swtTypeIndex:type.swtIdx,swtColorIndex:color.swtIdx,color:color.swtIdx===0?'Default':color.hex,scaleX:shape?marker.scaleX:scale,scaleY:shape?marker.scaleY:scale,angle,polyCoords:marker.polyCoords||[]};try{localStorage.setItem(STORE,JSON.stringify({type:type?.id,color:color.armaClass,scale,angle,rememberText:remember.checked,text:remember.checked?text.value:'',icons:quickTypes.map(t=>t?.id),colors:quickColors.map(c=>c.armaClass)}));}catch{}dialog.close();};
  const finish=()=>{if(settled)return;settled=true;observer.disconnect();options.signal?.removeEventListener('abort',abort);window.removeEventListener('resize',position);dialog.remove();resolve(result);};const abort=()=>{result=null;finish();};dialog.onclose=finish;dialog.oncancel=()=>{result=null;};options.signal?.addEventListener('abort',abort,{once:true});window.addEventListener('resize',position);
  const observer=new ResizeObserver(position);observer.observe(dialog);
  if(!document.querySelector('link[data-swt-editor]')){const css=el('link');css.rel='stylesheet';css.href='/planner/marker-editor.css';css.dataset.swtEditor='';document.head.append(css);}
  document.body.append(dialog);dialog.showModal();render();position();text.focus();
 });
}
