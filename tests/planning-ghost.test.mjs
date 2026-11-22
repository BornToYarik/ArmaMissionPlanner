import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../arma-planner-ui/public/planner/wog/vendor/three.module.js';
import {boardingGhostMesh} from '../arma-planner-ui/public/planner/planning-ghost.mjs';
test('boarding preview accepts cyclic unit metadata without changing the real model',()=>{
 const source=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()),unit={mesh:source};source.userData.unit=unit;
 const preview=boardingGhostMesh(source);assert.equal(preview.geometry,source.geometry);assert.notEqual(preview.material,source.material);
 assert.equal(preview.material.opacity,.5);assert.equal(source.material.opacity,1);assert.deepEqual(preview.userData,{});
 preview.material.dispose();source.material.dispose();source.geometry.dispose();
});
