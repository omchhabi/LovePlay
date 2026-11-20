const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');
const crypto=require('crypto');
const path=require('path');

const required=['DATABASE_URL','JWT_SECRET'];
for(const k of required) if(!process.env[k]) { console.error('Missing environment variable:',k); process.exit(1); }
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='disable'?false:{rejectUnauthorized:false}});
const app=express(),server=http.createServer(app);
const io=new Server(server,{cors:{origin:false}});
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'32kb'}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:150}));
app.use(express.static(path.join(__dirname,'public')));
const sign=u=>jwt.sign({id:u.id,email:u.email},process.env.JWT_SECRET,{expiresIn:'14d'});
async function auth(req,res,next){try{const h=req.headers.authorization||'';const t=h.startsWith('Bearer ')?h.slice(7):'';const p=jwt.verify(t,process.env.JWT_SECRET);const q=await pool.query('select id,name,email from users where id=$1',[p.id]);if(!q.rowCount)return res.status(401).json({error:'Account not found'});req.user=q.rows[0];next()}catch(e){res.status(401).json({error:'Please sign in again'})}}
function code(){return crypto.randomBytes(4).toString('hex').toUpperCase()}
async function init(){await pool.query(`
create table if not exists users(id uuid primary key default gen_random_uuid(),name text not null,email text unique not null,password_hash text not null,created_at timestamptz default now());
create table if not exists rooms(code text primary key,host_id uuid references users(id),guest_id uuid references users(id),created_at timestamptz default now());
create table if not exists messages(id bigserial primary key,room_code text references rooms(code) on delete cascade,user_id uuid references users(id),name text not null,text text not null,created_at timestamptz default now());
create table if not exists payment_requests(id text primary key,user_id uuid references users(id),plan text not null,amount integer not null,status text default 'pending',created_at timestamptz default now());
`)}
app.post('/api/register',async(req,res)=>{try{let {name,email,password}=req.body||{};name=String(name||'').trim().slice(0,50);email=String(email||'').trim().toLowerCase();if(!name||!/^\\S+@\\S+\\.\\S+$/.test(email)||String(password||'').length<8)return res.status(400).json({error:'Enter a name, valid email and password of at least 8 characters'});let hash=await bcrypt.hash(password,12);let q=await pool.query('insert into users(name,email,password_hash) values($1,$2,$3) returning id,name,email',[name,email,hash]);let u=q.rows[0];res.json({token:sign(u),user:u})}catch(e){res.status(400).json({error:e.code==='23505'?'Email already registered':'Registration failed'})}});
app.post('/api/login',async(req,res)=>{let email=String(req.body?.email||'').trim().toLowerCase();let q=await pool.query('select * from users where email=$1',[email]);if(!q.rowCount||!await bcrypt.compare(String(req.body?.password||''),q.rows[0].password_hash))return res.status(401).json({error:'Invalid email or password'});let u=q.rows[0];res.json({token:sign(u),user:{id:u.id,name:u.name,email:u.email}})});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));
app.post('/api/rooms',auth,async(req,res)=>{let c=code();await pool.query('insert into rooms(code,host_id) values($1,$2)',[c,req.user.id]);res.json({code:c})});
app.post('/api/rooms/join',auth,async(req,res)=>{let c=String(req.body?.code||'').toUpperCase();let q=await pool.query('select * from rooms where code=$1',[c]);if(!q.rowCount)return res.status(404).json({error:'Invite code not found'});let r=q.rows[0];if(r.host_id===req.user.id||r.guest_id===req.user.id)return res.json({code:c});if(r.guest_id)return res.status(409).json({error:'This room already has two players'});await pool.query('update rooms set guest_id=$1 where code=$2 and guest_id is null',[req.user.id,c]);res.json({code:c})});
app.get('/api/rooms/:code/messages',auth,async(req,res)=>{let c=req.params.code.toUpperCase();let r=await pool.query('select 1 from rooms where code=$1 and (host_id=$2 or guest_id=$2)',[c,req.user.id]);if(!r.rowCount)return res.status(403).json({error:'Not a member of this room'});let q=await pool.query('select user_id as "userId",name,text,created_at as "createdAt" from messages where room_code=$1 order by id asc limit 100',[c]);res.json({messages:q.rows})});
app.post('/api/rooms/:code/messages',auth,async(req,res)=>{let c=req.params.code.toUpperCase(),text=String(req.body?.text||'').trim().slice(0,1000);if(!text)return res.status(400).json({error:'Message is empty'});let r=await pool.query('select 1 from rooms where code=$1 and (host_id=$2 or guest_id=$2)',[c,req.user.id]);if(!r.rowCount)return res.status(403).json({error:'Not a member of this room'});let q=await pool.query('insert into messages(room_code,user_id,name,text) values($1,$2,$3,$4) returning user_id as "userId",name,text,created_at as "createdAt"',[c,req.user.id,req.user.name,text]);io.to(c).emit('chat',q.rows[0]);res.json({ok:true})});
app.post('/api/payments/request',auth,async(req,res)=>{const plans={monthly:149,six_months:399,lifetime:1999};let plan=req.body?.plan;if(!plans[plan])return res.status(400).json({error:'Invalid membership plan'});let id=crypto.randomBytes(6).toString('hex').toUpperCase();await pool.query('insert into payment_requests(id,user_id,plan,amount) values($1,$2,$3,$4)',[id,req.user.id,plan,plans[plan]]);res.json({requestId:id,status:'pending'})});
const sockets=new Map();
io.use(async(socket,next)=>{try{let p=jwt.verify(socket.handshake.auth?.token,process.env.JWT_SECRET);let q=await pool.query('select id,name from users where id=$1',[p.id]);if(!q.rowCount)return next(new Error('Unauthorized'));socket.user=q.rows[0];next()}catch(e){next(new Error('Unauthorized'))}});
io.on('connection',socket=>{
 socket.on('join-room',async({code:c}={})=>{c=String(c||'').toUpperCase();let q=await pool.query('select host_id,guest_id from rooms where code=$1',[c]);if(!q.rowCount||![q.rows[0].host_id,q.rows[0].guest_id].includes(socket.user.id))return;socket.join(c);sockets.set(socket.id,c);socket.to(c).emit('peer-joined',{name:socket.user.name,socketId:socket.id});let peers=Array.from(io.sockets.adapter.rooms.get(c)||[]).filter(x=>x!==socket.id);if(peers.length)socket.emit('peer-joined',{name:'Partner',socketId:peers[0]})});
 socket.on('call-signal',({room:c,target,type,description,candidate}={})=>{if(sockets.get(socket.id)!==c)return;if(!['offer','answer','ice'].includes(type))return;if(target&&io.sockets.sockets.has(target))io.to(target).emit('call-signal',{from:socket.id,type,description,candidate})});
 socket.on('game-event',({room:c,game}={})=>{if(sockets.get(socket.id)!==c||!['jungle','race'].includes(game))return;socket.to(c).emit('game-event',{game,by:socket.user.name})});
 socket.on('send-reaction',({room:c,emoji}={})=>{const allowed=['❤️','😍','😘','😂','🔥','👏','🎉','😱','💯'];if(sockets.get(socket.id)!==c||!allowed.includes(emoji))return;socket.to(c).emit('reaction',{emoji,name:socket.user.name})});
 socket.on('disconnect',()=>sockets.delete(socket.id));
});
app.get('/health',(_,res)=>res.json({ok:true}));
const port=process.env.PORT||3000;
init().then(()=>server.listen(port,()=>console.log('LovePlay listening on '+port))).catch(e=>{console.error(e);process.exit(1)});
