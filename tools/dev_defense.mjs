import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('..',import.meta.url));
const children=[
  spawn(process.execPath,['tools/serve_defense.mjs'],{cwd,stdio:'inherit',detached:process.platform!=='win32'}),
  spawn('npm',['run','dev:portal'],{cwd,stdio:'inherit',detached:process.platform!=='win32'})
];
let closing=false;
function stop(code=0){if(closing)return;closing=true;for(const child of children){try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{}}process.exitCode=code;}
for(const child of children){child.on('error',error=>{console.error(error);stop(1);});child.on('exit',code=>{if(!closing)stop(code??1);});}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
