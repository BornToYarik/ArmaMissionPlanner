import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {unitMapIcon,normalizedHeading} from '../arma-planner-ui/src/unit-map-icons.ts';
import {markerAssets} from '../arma-planner-ui/public/planner/wog/marker-catalog.js';

test('WOG 2D categories distinguish infantry, armour, trucks, aircraft and static weapons',()=>{
 for(const [mobility,vehicleClass,expected] of [
  ['foot','rhs_msv_rifleman','man'],['wheeled','rhsgref_ins_gaz66o','truck'],
  ['wheeled','rhs_btr60','apc'],['tracked','rhs_bmp2','apc'],['tracked','rhs_t72ba','tank'],
  ['wheeled','rhs_uaz_msv_01','car'],['air','rhs_uh60m','heli'],['air','rhs_mi8amt','heli'],
  ['air','CUP_O_MiG29_RU','plane'],['air','RHS_Su25SM','plane'],
  ['static','rhs_2b14_82mm_msv','static-mortar'],['static','rhs_Kornet_9M133','static-weapon'],
  ['water','B_Boat_Transport_01_F','sea']
 ]){
  const icon=unitMapIcon({mobility,vehicleClass});assert.equal(icon,expected,vehicleClass);
  assert.ok(fs.existsSync(new URL('../arma-planner-ui/public/planner/2d-icons/'+icon+'.svg',import.meta.url)));
 }
 assert.equal(normalizedHeading(-90),270);assert.equal(normalizedHeading(450),90);assert.equal(normalizedHeading(NaN),0);
});
test('SWT quick presets retain recorded indices and include their original textures offline',()=>{
 const catalog=JSON.parse(fs.readFileSync(new URL('../arma-planner-ui/public/planner/marker-native.json',import.meta.url)));
 for(const [id,index] of [['mil_dot',30],['o_inf',64],['o_armor',73],['hd_pickup',52],['hd_warning',56],['hd_unknown',58]]){
  assert.equal(catalog[index].id,id);assert.ok(catalog[index].hasIcon);
  assert.ok(fs.existsSync(new URL('../arma-planner-ui/public/'+markerAssets[id],import.meta.url)),id);
 }
 for(const row of catalog.filter(x=>x.hasIcon))assert.ok(fs.existsSync(new URL('../arma-planner-ui/public/'+markerAssets[row.id.toLowerCase()],import.meta.url)),row.id);
});
