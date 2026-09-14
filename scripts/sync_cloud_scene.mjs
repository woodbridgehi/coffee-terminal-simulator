// Explicitly publish the same built viewer to the sibling cloud checkout.
// The cloud image serves these files itself; phones never connect to device localhost.
import {copyFile,mkdir} from 'node:fs/promises';
const output=new URL('../../coffee-cloud-mvp/public/robot/',import.meta.url);
await mkdir(output,{recursive:true});
for(const name of ['process-audio.bundle.js','robot-live.bundle.js','robot-integration.bundle.js','robot-live.css'])
  await copyFile(new URL(`../coffee-terminal/web/${name}`,import.meta.url),new URL(name,output));
await copyFile(new URL('../coffee-terminal/web/robot/THREE-LICENSE.txt',import.meta.url),new URL('THREE-LICENSE.txt',output));
console.log('Cloud viewer assets synchronized.');

// Keep the shared status sound controller and controls identical on both surfaces.
for (const name of ['status-sound.js', 'status-sound.css'])
  await copyFile(new URL(`../coffee-terminal/web/${name}`, import.meta.url), new URL(`../shared/${name}`, output));

// Embedded PBR textures travel inside the GLB; keep the same bundle-relative URL.
await mkdir(new URL('assets/scene/',output),{recursive:true});
await copyFile(new URL('../coffee-terminal/web/assets/scene/coffee-shop-v1.glb',import.meta.url),new URL('assets/scene/coffee-shop-v1.glb',output));
