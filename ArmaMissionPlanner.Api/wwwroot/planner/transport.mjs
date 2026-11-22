export const carriedBy=(vehicle,all)=>all.filter(u=>u.carrier===vehicle.id);
export const loadable=u=>u.mobility==='foot'||u.mobility==='static'&&u.gameplay===true;
export function loadUnits(items,vehicle,all){
 if(['foot','static'].includes(vehicle.mobility)||vehicle.carrier!=null)throw Error('Выберите транспортную машину');
 if(!items.length||items.some(u=>u.id===vehicle.id||!loadable(u)))throw Error('Перетаскивайте пехоту или статическое вооружение');
 const ids=new Set(items.map(u=>u.id)),existing=carriedBy(vehicle,all).filter(u=>!ids.has(u.id)),combined=[...existing,...items];
 const people=combined.filter(u=>u.mobility==='foot'),cargo=combined.filter(u=>u.mobility!=='foot');
 if(people.length&&(!Number.isInteger(vehicle.capacity)||people.length>vehicle.capacity))throw Error('В машине недостаточно подтверждённых мест для людей');
 if(cargo.length){
  if(vehicle.cargoEnabled===false||!Number.isFinite(vehicle.cargoSpace)||vehicle.cargoSpace<=0)throw Error('У машины нет подтверждённого грузового объёма ACE в конфигах');
  if(cargo.some(u=>u.cargoLoadable===false||!Number.isFinite(u.cargoSize)||u.cargoSize<0))throw Error('Размер или разрешение погрузки станка отсутствует в конфигах ACE');
  if(cargo.reduce((n,u)=>n+u.cargoSize,0)>vehicle.cargoSpace)throw Error('В машине недостаточно грузового места для станков');
 }
 for(const u of items){u.carrier=vehicle.id;u.point=[...vehicle.point];}
}
// Propose every position before changing any state. No overlapping stacks or
// partial disembarkation when the area is obstructed.
export function unloadPositions(vehicle,items,all,{height,clear,radius=4}){
 const chosen=[],occupied=all.filter(u=>u.carrier==null&&u.id!==vehicle.id).map(u=>({point:u.point,radius:u.mobility==='foot'?.65:u.selectionRadius||2}));
 for(const u of items){let found;
  const gap=u.mobility==='foot'?1.3:3;
  for(let ring=0;ring<12&&!found;ring++){const r=radius+ring*2.5,count=Math.max(12,Math.floor(2*Math.PI*r/2));for(let i=0;i<count;i++){
   const a=i/count*Math.PI*2,x=vehicle.point[0]+Math.cos(a)*r,y=vehicle.point[1]+Math.sin(a)*r,z=height(x,y),p=[x,y,z];
   if(!Number.isFinite(z)||z<0||!clear(p,gap)||[...occupied,...chosen.map(c=>({point:c.point,radius:c.radius}))].some(q=>Math.hypot(q.point[0]-x,q.point[1]-y)<gap/2+q.radius))continue;
   found=p;break;
  }}
  if(!found)throw Error('Вокруг машины недостаточно свободного места для высадки');
  chosen.push({id:u.id,point:found,radius:gap/2});
 }return chosen;
}
