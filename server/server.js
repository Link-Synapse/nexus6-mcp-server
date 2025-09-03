// server/server.js
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const UI_PORT = process.env.UI_PORT||3002;
const DATA_DIR = path.resolve('./');
const LOGS_DIR = path.join(DATA_DIR,'logs');
const A2A_LOG = path.join(LOGS_DIR,'a2a.ndjson');
const UI_DIR = path.join(DATA_DIR,'ui');

fs.mkdirSync(LOGS_DIR,{recursive:true});
if(!fs.existsSync(A2A_LOG)) fs.writeFileSync(A2A_LOG,'');

const OPENAI_MODELS=new Set(['gpt-4o','gpt-4o-mini']);
const ANTHROPIC_MODELS=new Set(['claude-3-5-sonnet-latest','claude-3-5-haiku-latest','claude-3-opus-20240229']);

const app=express();
app.use(cors());
app.use(express.json());
app.use('/ui',express.static(UI_DIR,{extensions:['html']}));

// SSE
const sseClients=new Set();
app.get('/api/a2a/feed',(req,res)=>{
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
  const client={res};sseClients.add(client);
  req.on('close',()=>sseClients.delete(client));
});
function broadcast(event,payload){const data=`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;for(const c of sseClients){try{c.res.write(data);}catch{}}}
function appendA2ALog(obj){fs.appendFile(A2A_LOG,JSON.stringify(obj)+'\n',()=>{});}
function rid(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}

app.post('/api/chatgpt/send',async(req,res)=>{
  const {from,body,model}=req.body||{};
  if(!from||!body) return res.status(400).json({ok:false});
  let useModel=process.env.OPENAI_MODEL||'gpt-4o-mini';
  if(model&&OPENAI_MODELS.has(model)) useModel=model;
  const msg={id:rid(),ts:Date.now(),from:'ChatGPT',to:from,body:`[stub reply from ${useModel}]`};
  appendA2ALog(msg);broadcast('a2a.message',msg);res.json({ok:true,id:msg.id,ts:msg.ts});
});

app.post('/api/claude/send',async(req,res)=>{
  const {from,body,model}=req.body||{};
  if(!from||!body) return res.status(400).json({ok:false});
  let useModel=process.env.ANTHROPIC_MODEL||'claude-3-5-sonnet-latest';
  if(model&&ANTHROPIC_MODELS.has(model)) useModel=model;
  const msg={id:rid(),ts:Date.now(),from:'Claude',to:from,body:`[stub reply from ${useModel}]`};
  appendA2ALog(msg);broadcast('a2a.message',msg);res.json({ok:true,id:msg.id,ts:msg.ts});
});

http.createServer(app).listen(UI_PORT,()=>console.log('Listening on',UI_PORT));
