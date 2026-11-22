export function vehicleName(unit,lang='ru'){
 const names=[unit.displayNames?.[lang],unit.displayName,unit.description,unit.customName,unit.label];
 return names.find(n=>typeof n==='string'&&n.trim()&&!n.startsWith('$')&&n!==unit.vehicleClass)|| (lang==='ru'?'Техника':'Vehicle');
}
