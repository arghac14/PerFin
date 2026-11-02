const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.json':'application/json'};
http.createServer((req,res)=>{
  let p;try{p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  if(p==='/')p='/index.html';
  const allowed=['/index.html','/icon.svg','/icon-192.png','/icon-512.png','/manifest.webmanifest','/sw.js'].includes(p)||/^\/(app|vendor)\/[A-Za-z0-9_.-]+$/.test(p);
  const file=path.resolve(root,'.'+p);
  if(!allowed||!file.startsWith(root+path.sep)){res.writeHead(404).end('Not found');return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}).end(data);});
}).listen(Number(process.env.PERFIN_PORT)||4173,'127.0.0.1',()=>console.log(`PerFin preview: http://127.0.0.1:${Number(process.env.PERFIN_PORT)||4173}`));
