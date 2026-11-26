import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const directory=resolve(root,option('--dir','game/cat-defense'));
const port=Number(option('--port',process.env.GAME_PORT??'8780'));
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid --port.');
const mimes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.woff2':'font/woff2','.wav':'audio/wav','.mp3':'audio/mpeg'};
const server=http.createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
    let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
    if(pathname.endsWith('/'))pathname+='index.html';
    let base=directory, relative=pathname.slice(1);
    // Source-only convenience. Portable builds include their own sdk/ directory.
    if(pathname.startsWith('/sdk/')&&directory===resolve(root,'game/cat-defense')){base=resolve(root,'packages/cat-defense-sdk');relative=pathname.slice(5);}
    const filename=resolve(base,relative);
    if(!filename.startsWith(base+sep)){res.writeHead(403).end('Forbidden');return;}
    const info=await stat(filename);
    if(!info.isFile())throw new Error('Not a file');
    res.writeHead(200,{'Content-Type':mimes[extname(filename)]??'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:await readFile(filename));
  }catch(error){res.writeHead(error instanceof URIError?400:404,{'Content-Type':'text/plain'}).end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Cat Defense: http://127.0.0.1:${port}/\nStatic folder: ${directory}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
