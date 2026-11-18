import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end('Bad request');return;}
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');
  const filename=path.resolve(root,relative);
  if(!filename.startsWith(root+path.sep)&&filename!==path.join(root,'index.html')){res.writeHead(403).end('Forbidden');return;}
  try{if(!statSync(filename).isFile()){res.writeHead(404).end('Not found');return;}}catch{res.writeHead(404).end('Not found');return;}
  res.writeHead(200,{'content-type':types[path.extname(filename)]||'application/octet-stream','cache-control':'no-cache'});
  createReadStream(filename).pipe(res);
});
const port=Number(process.env.PORT||3000);
server.listen(port,'127.0.0.1',()=>console.log(`Spaced is running at http://localhost:${port}`));
