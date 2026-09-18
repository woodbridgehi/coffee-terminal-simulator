import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fk,ik} from '../../coffee-terminal/web/twin/robot.mjs';
import {validateWorld} from '../../coffee-terminal/web/twin/schema.mjs';
test('expanded URDF origins, fixed joints, axes and limits reproduce a known six-joint chain',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'coffee-urdf-'));
  try {
    const template=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-v1.json',import.meta.url)));
    template.robots.left.home=[0,0,0,0,0,0];template.robots.left.base={position:[0,0,0],quaternion:[0,0,0,1]};template.robots.left.tool={position:[0,0,0],quaternion:[0,0,0,1]};
    const xml=`<robot name="test-arm"><link name="base"/>${Array.from({length:6},(_,i)=>`<link name="l${i}"/><joint name="j${i}" type="revolute"><parent link="${i?'l'+(i-1):'base'}"/><child link="l${i}"/><origin xyz=".1 0 0"/><axis xyz="0 0 1"/><limit lower="-3.14" upper="3.14" velocity="1.2"/></joint>`).join('')}<link name="tool"/><joint name="fixed-tip" type="fixed"><parent link="l5"/><child link="tool"/><origin xyz=".05 0 0"/></joint></robot>`;
    await writeFile(join(dir,'robot.urdf'),xml);await writeFile(join(dir,'world.json'),JSON.stringify(template));
    execFileSync('python3',['scripts/import_twin_urdf.py',join(dir,'robot.urdf'),'--world',join(dir,'world.json'),'--robot','left','--base','base','--tip','tool','--output',join(dir,'out.json')]);
    const world=validateWorld(JSON.parse(await readFile(join(dir,'out.json')))),r=world.robots.left;
    assert.equal(r.chain.length,7);assert.equal(r.jointNames[0],'j0');assert.equal(r.limits[0].velocity,1.2);
    const out=fk(r,[Math.PI/2,0,0,0,0,0]);assert.ok(Math.abs(out.position[0]-.1)<1e-9);assert.ok(Math.abs(out.position[1]-.55)<1e-9);
    const target=fk(r,[.1,.2,.1,.1,.2,.1]),sol=fk(r,ik(r,target,[.11,.19,.11,.11,.19,.11]));assert.ok(Math.hypot(...target.position.map((v,i)=>v-sol.position[i]))<1e-4);
  } finally {await rm(dir,{recursive:true,force:true});}
});
