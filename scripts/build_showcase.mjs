import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const [entry,outfile] of [['terminal','showcase.js'],['manager','showcase/manager.bundle.js'],['preview','showcase/preview.bundle.js']]){
  await build({absWorkingDir:root,entryPoints:[`coffee-terminal/web/showcase/${entry}.mjs`],outfile:`coffee-terminal/web/${outfile}`,bundle:true,minify:true,format:'iife',target:['es2020']});
}
console.log('Built independent showcase player, manager and preview.');
