import {cp,mkdir,readFile,writeFile,readdir,stat,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=join(root,'game/cat-defense');
const output=join(root,'build/cat-defense-standalone');
const files=['index.html','styles.css','embedded.css','bootstrap.js','bridge.js','engine.js','render.js','rules.js','game.js','character-layout.js','actor-bounds.js'];
for(const file of files)await stat(join(source,file));
const manifest=JSON.parse(await readFile(join(source,'assets/manifest.json'),'utf8'));
if(!manifest.cats||Object.keys(manifest.cats).length<17)throw new Error('Expected all 17 native cat variants. Run python3 tools/package_defense_assets.py first.');
const assetFiles=new Set();
function findAssetFiles(value){
  if(typeof value==='string'&&/\.(?:webp|png|jpg|json|txt)$/.test(value))assetFiles.add(value);
  else if(Array.isArray(value))value.forEach(findAssetFiles);
  else if(value&&typeof value==='object')Object.values(value).forEach(findAssetFiles);
}
findAssetFiles(manifest);
for(const file of assetFiles){
  const path=resolve(source,'assets',file);
  if(!path.startsWith(join(source,'assets')+'/'))throw new Error(`Unsafe asset path: ${file}`);
  if(!(await stat(path)).isFile())throw new Error(`Missing asset: ${file}`);
}
await mkdir(output,{recursive:true});
// Clear this tool's exact output only. Other build/render/fishing folders stay intact.
for(const entry of await readdir(output))await rm(join(output,entry),{recursive:true,force:true});
for(const file of files)await cp(join(source,file),join(output,file));
await cp(join(source,'assets'),join(output,'assets'),{recursive:true});
await cp(join(source,'examples'),join(output,'examples'),{recursive:true});
await cp(join(root,'packages/cat-defense-sdk'),join(output,'sdk'),{recursive:true,filter:path=>!path.includes('node_modules')});
await cp(join(root,'docs/cat-defense.md'),join(output,'INTEGRATION.md'));
const metadata={format:'cat-defense-standalone-v1',protocolVersion:1,builtAt:new Date().toISOString(),cats:Object.keys(manifest.cats).length,enemies:Object.keys(manifest.enemies??{}).length,entry:'index.html',hostExample:'examples/host.html',sdk:'sdk/index.js',requires:'HTTP static server only. No Node, React, build step or CDN needed at runtime.'};
await writeFile(join(output,'build-info.json'),JSON.stringify(metadata,null,2)+'\n');
const archive=join(root,'build/cat-defense-standalone.zip');
const result=spawnSync('python3',['-c',"import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob('*')):\n  if f.is_file(): z.write(f, f.relative_to(p))",output,archive],{stdio:'inherit'});
if(result.status!==0)throw new Error('Unable to create standalone zip.');
console.log(`Static game ready: ${output}\nPortable zip: ${archive}\n${metadata.cats} cats, ${metadata.enemies} enemies. No render step ran.`);
