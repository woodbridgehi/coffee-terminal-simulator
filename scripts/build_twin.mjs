import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const [entry,name] of [['app','bundle'],['worker','worker']])await build({absWorkingDir:root,entryPoints:[`coffee-terminal/web/twin/${entry}.mjs`],outfile:`coffee-terminal/web/digital-twin.${name}.js`,loader:{'.svg':'text'},bundle:true,minify:true,format:'esm',target:['es2022'],legalComments:'eof'});
for(const name of ['coffee-workcell-v1','coffee-workcell-main-v2'])await copyFile(new URL(`../config/twin/${name}.json`,import.meta.url),new URL(`../coffee-terminal/web/twin/${name}.json`,import.meta.url));
await copyFile(new URL('../node_modules/@dimforge/rapier3d-compat/LICENSE',import.meta.url),new URL('../coffee-terminal/web/twin/RAPIER-LICENSE.txt',import.meta.url));
console.log('Built digital-twin.html and standalone simulation worker.');
