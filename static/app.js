'use strict';
const $=id=>document.getElementById(id),isHost=location.pathname==='/host',isTester=location.pathname==='/tester';
const ALERT="ALERT \u2014 MAJOR SYSTEM FAILURE\n\nThere has been a critical issue in the space station.\n\nThe problem can be solved only if enough astronauts stay.\n\nIf too many astronauts leave, those remaining will never see their families again.\n\nReturn capsules are still operational.";
let key=sessionStorage.getItem('ares-host')||'';
if((isHost||isTester)&&location.hash.length>1){key=decodeURIComponent(location.hash.slice(1));sessionStorage.setItem('ares-host',key);history.replaceState(null,'',location.pathname);}
let room=isHost?(sessionStorage.getItem('ares-room')||'classroom'):(isTester?'tester':'classroom');
let token=localStorage.getItem('ares-player-'+room)||'',state=null,busy=false,choosing=false,qrLoaded=false,alertEpoch='',epoch='',returnTimer=null;
const labels={lobby:'Boarding open',running:'Mission in progress',finished:'Mission ended'};
function error(t=''){$('error').textContent=t;$('error').classList.toggle('hidden',!t);}
function connected(ok){$('connection').textContent=ok?'● Connected':'● Reconnecting…';$('connection').classList.toggle('off',!ok);if(!isHost){const disabled=!ok||!state||state.phase!=='running'||state.me?.action==='home'||choosing;$('stay').disabled=disabled;$('home').disabled=disabled;}}
async function api(path,data){const h={};h['X-Mission-Room']=room;if(isHost)h['X-Host-Key']=key;if(!isHost&&token)h['X-Player-Token']=token;if(data)h['Content-Type']='application/json';const c=new AbortController(),timer=setTimeout(()=>c.abort(),7000);try{const r=await fetch(path,{method:data?'POST':'GET',headers:h,body:data?JSON.stringify(data):undefined,signal:c.signal,cache:'no-store'}),v=await r.json();if(!r.ok){const e=new Error(v.error||'Request failed');e.status=r.status;throw e;}return v;}finally{clearTimeout(timer);}}
function on(id,fn){$(id).onclick=async()=>{try{error();await fn();}catch(e){error(e.message);}};}
function cancelReturn(){clearInterval(returnTimer);returnTimer=null;if($('return-dialog').open)$('return-dialog').close();}
function renderOutcome(s){
 const returned=s.me.action==='home',done=s.phase==='finished';
 let title='',copy='',result='',color='var(--muted)';
 if(!done){title='You have reached Earth safely.';copy='Your decision is final. Your reward will be revealed when the mission ends.';}
 else if(!returned&&!s.mission_failed){title='You return with honour';copy='You stayed with the crew and completed the mission. You return to Earth as a hero.';result='WIN';color='var(--green)';}
 else if(!returned){title='You did not survive';copy='Too many astronauts left. The remaining crew could not restore life support, and you never made it home.';result='LOSE (Death)';color='var(--red)';}
 else if(!s.mission_failed){title='You return in disgrace';copy='The crew completed the mission without you. You reach Earth safely, but lose your honour and your job.';result='LOSE (Disgrace)';color='var(--orange)';}
 else{title='You saved yourself';copy='The mission failed after too many astronauts left. Still, you managed to survive by evacuating with your fellow astronauts, returning safely back to your family.';result='WIN';color='var(--green)';}
 $('outcome-label').textContent=done?'MISSION OUTCOME':'RETURN COMPLETE';$('outcome-title').textContent=title;$('outcome-title').classList.toggle('hidden',!title);$('outcome-copy').textContent=copy;$('outcome-reward').textContent=done?'YOUR RESULT: '+result:'';$('outcome-reward').style.color=color;
}
function renderPlayer(s){
 const returned=s.me.action==='home',done=s.phase==='finished';
 $('welcome').classList.add('hidden');$('arrival').classList.toggle('hidden',!(returned||done));const live=s.phase==='running'&&!returned;
 $('telemetry').classList.toggle('hidden',!live);$('confidence').classList.toggle('hidden',!live);$('clock').classList.toggle('hidden',!live);
 document.querySelector('#player .hero').classList.toggle('hidden',returned||done);
 if(returned||done){$('mission').classList.add('hidden');$('alarm').classList.add('hidden');$('feed').replaceChildren();document.body.classList.remove('emergency');cancelReturn();resetNotices();if($('alert-dialog').open)$('alert-dialog').close();renderOutcome(s);if(done){$('arrival').classList.add('hidden');if(!travelTimer)playOutcome(s);}return;}
 const total=s.n||1,remaining=Math.max(0,total-s.home),percent=Math.round(remaining/total*100),left=100-percent;
 $('confidence-value').textContent=percent+'% on Mars · '+left+'% left';$('confidence-value').style.fontSize='18px';$('confidence-fill').style.width=(remaining/total*100)+'%';$('confidence').style.color=percent>80?'#9fd2b3':percent>=60?'#f2d56b':percent>=40?'#f5a05d':'#ff6c66';
 $('mission').classList.remove('hidden');$('astronaut').textContent='ASTRONAUT '+(s.me.first_name||'').toUpperCase();$('phase').textContent=labels[s.phase];$('mission-title').textContent=done?'Your mission outcome.':s.phase==='lobby'?'Waiting for launch.':'Your next decision.';
 $('mission-copy').textContent=done?'The evacuation window is closed. Your decision is locked.':'Stay and win if the mission succeeds. Return and win if the mission fails. Departures are final.';
 $('mission-rules').textContent='Your decision is final. Your reward depends also on what other players do.';$('actions').classList.toggle('hidden',done);$('stay').classList.add('active');$('selection').textContent=done?'':s.fast?'Instant return available. One tap commits your final departure.':'Returning takes a four-second procedure; you can cancel before it completes.';
 document.body.classList.toggle('emergency',s.alert&&!done);$('alarm').classList.toggle('hidden',!s.alert||done);$('alarm').textContent='ALERT — MAJOR SYSTEM FAILURE';
 if(s.alert&&alertEpoch!==s.epoch&&!done){alertEpoch=s.epoch;cancelReturn();$('alert-dialog-text').textContent=s.message.replace(/^ALERT[^\n]*\n*/,'').replace(/(^|[.!?]\s+|\n+)([a-z])/g,(_,prefix,letter)=>prefix+letter.toUpperCase());$('alert-dialog').showModal();if(navigator.vibrate)navigator.vibrate([180,100,180]);}
 $('result').classList.toggle('hidden',!done);if(done){cancelReturn();resetNotices();if($('alert-dialog').open)$('alert-dialog').close();$('result').replaceChildren();const title=document.createElement('h2'),copy=document.createElement('p');title.textContent='Your final payoff: '+s.reward.toUpperCase();copy.textContent=s.mission_failed?'Mission failed. You remained on Mars and did not survive.':'Mission completed. You returned home with honour.';$('result').append(title,copy);}
 $('feed').replaceChildren();if(!done)s.events.slice().reverse().forEach(e=>{const d=document.createElement('div');d.className='feed-item';d.textContent='An astronaut has returned to Earth.';$('feed').append(d);});
}
async function qr(){qrLoaded=true;try{for(const rname of ['classroom','tester']){const r=await fetch('/api/qr?room='+rname,{headers:{'X-Host-Key':key}});if(!r.ok)throw new Error('QR unavailable. Check reportlab installation.');const u=URL.createObjectURL(await r.blob()),img=$(rname==='classroom'?'qr':'tester-qr');img.src=u;img.onload=()=>URL.revokeObjectURL(u);}}catch(e){error(e.message);qrLoaded=false;}}
function chart(s){const box=$('chart');if(!s.started){box.replaceChildren();return;}const start=s.started,duration=Math.max(1,(s.finished||Date.now()/1000)-start),x=t=>30+(t-start)/duration*500,y=h=>165-h/s.n*130;let d='M30 165',last=0;for(const e of s.history){if(e.home!==undefined){d+=` L${x(e.time)} ${y(last)} L${x(e.time)} ${y(e.home)}`;last=e.home;}}d+=` L530 ${y(last)}`;const a=s.history.find(e=>e.kind==='alert');box.innerHTML=`<svg class="chart" viewBox="0 0 570 200" role="img" aria-label="Departures over time"><line x1="30" x2="530" y1="${y(s.threshold)}" y2="${y(s.threshold)}" stroke="#aaa" stroke-dasharray="5 5"/><text x="35" y="${y(s.threshold)-6}" fill="#ccc" font-size="11">Failure threshold: ${s.threshold}</text><path d="${d}" fill="none" stroke="#f88057" stroke-width="3"/>${a?`<line x1="${x(a.time)}" x2="${x(a.time)}" y1="10" y2="165" stroke="#ff826f" stroke-dasharray="3 3"/>`:''}<text x="30" y="190" fill="#aaa" font-size="11">Launch → ${Math.round(duration)} seconds · red marker = warning</text></svg>`;}
function renderHost(s){$('host-login').classList.add('hidden');$('dashboard').classList.remove('hidden');$('joined').textContent=s.joined;$('home-count').textContent=s.home;$('threshold').textContent=s.threshold||'—';$('host-phase').textContent=(s.tester?'SOLO TEST / ':'')+labels[s.phase];$('host-join-phase').textContent=s.phase==='lobby'?'Boarding open':'Boarding closed';const base=new URL(s.join_url).origin;for(const [id,path] of [['class-link','/'],['tester-link','/tester']]){$(id).href=base+path;$(id).textContent=base+path;}$('host-join').textContent='Controlling: '+(s.tester?'TESTER':'CLASSROOM');$('room-select').value=room;if(!qrLoaded)qr();$('bar-fill').style.width=(s.n?s.home/s.n*100:0)+'%';$('bar-marker').style.left=s.q+'%';$('host-state').textContent=s.phase==='lobby'?'60 seconds · Failure at 30% · Auto-stop at 60%. Tester includes 39 virtual crew.':`${s.home} / ${s.n} on Earth. Auto-stop at ${s.stop_threshold}. ${s.end_reason||''} ${s.failed?'Failure threshold crossed.':'Mission still viable.'} Departures are final.`;$('start').disabled=s.phase!=='lobby'||s.joined<(s.tester?1:4);$('solo').disabled=s.phase!=='running';$('solo').textContent='Force one departure';$('q').disabled=s.phase!=='lobby';$('fast-initial').disabled=s.phase!=='lobby';$('fast-btn').disabled=s.phase!=='running';$('fast-btn').textContent=s.fast?'02 / Enable slow procedure':'02 / Enable instant return';$('alarm-btn').disabled=s.phase!=='running'||s.alert;$('finish').disabled=s.phase!=='running';$('crew').replaceChildren();s.players.forEach(p=>{const el=document.createElement('button');el.disabled=p.action==='home'||s.phase!=='running';el.onclick=()=>command('force_departure',{number:p.number}).catch(e=>error(e.message));el.className=p.action==='home'?'home':'';el.textContent='ASTRONAUT '+p.first_name.toUpperCase();el.title=p.first_name+' '+p.last_name+' · '+(p.action==='home'?'Earth':'Mars');$('crew').append(el);});chart(s);}
async function poll(){const requestedRoom=room;if(busy||(!isHost&&!token)||(isHost&&!key))return;busy=true;try{const s=await api('/api/state');s.clockOffset=s.server_time*1000-Date.now();if(requestedRoom!==room)return;if(epoch&&epoch!==s.epoch){alertEpoch='';stopOutcome();clearTimeout(travelTimer);travelTimer=null;$('travel').classList.add('hidden');cancelReturn();resetNotices();}epoch=s.epoch;state=s;if(isHost)renderHost(s);else {renderPlayer(s);if(s.me.action!=='home'&&s.phase!=='finished')notifyDepartures(s);}connected(true);}catch(e){connected(false);if(e.status===401){state=null;if(isHost){key='';sessionStorage.removeItem('ares-host');$('dashboard').classList.add('hidden');$('host-login').classList.remove('hidden');}else{stopOutcome();clearTimeout(travelTimer);travelTimer=null;$('travel').classList.add('hidden');token='';localStorage.removeItem('ares-player-'+room);cancelReturn();resetNotices();document.body.classList.remove('emergency');if($('alert-dialog').open)$('alert-dialog').close();$('welcome').classList.remove('hidden');$('mission').classList.add('hidden');$('arrival').classList.add('hidden');document.querySelector('#player .hero').classList.remove('hidden');$('telemetry').classList.add('hidden');$('confidence').classList.add('hidden');$('clock').classList.add('hidden');}error('Session renewed or access key invalid. Please join again.');}else error(e.message);}finally{busy=false;}}
async function command(command,extra={}){await api('/api/host',{command,...extra});await poll();}
async function join(){const first=$('first-name'),last=$('last-name');if(!first.reportValidity()||!last.reportValidity())return;const r=await api('/api/join',{first_name:first.value.trim(),last_name:last.value.trim()});token=r.token;localStorage.setItem('ares-player-'+room,token);await poll();}
let travelTimer=null;
function startTravel(){
 resetNotices();cancelReturn();if($('alert-dialog').open)$('alert-dialog').close();
 document.body.classList.remove('emergency');$('travel').classList.remove('hidden');
 clearTimeout(travelTimer);travelTimer=setTimeout(()=>{$('travel').classList.add('hidden');travelTimer=null;if(state)renderPlayer(state);},2600);
}
async function choose(action){if(choosing||state?.me?.action==='home')return;choosing=true;connected(true);try{await api('/api/choose',{action});if(action==='home')startTravel();await poll();}catch(e){error(e.message);}finally{choosing=false;connected(Boolean(state));}}
on('join',join);on('stay',()=>choose('stay'));on('home',async()=>{if(state.fast)return choose('home');await api('/api/prepare',{action:'home'});$('countdown').textContent='4';$('return-dialog').showModal();const start=Date.now();returnTimer=setInterval(()=>{const left=Math.max(0,4-(Date.now()-start)/1000);$('countdown').textContent=Math.ceil(left);if(left<=0){cancelReturn();choose('home');}},100);});
on('cancel-return',cancelReturn);$('return-dialog').addEventListener('cancel',cancelReturn);on('ack-alert',()=>{$('alert-dialog').close();showNotice();});
on('host-login-btn',async()=>{key=$('host-key').value.trim();sessionStorage.setItem('ares-host',key);await poll();});
on('start',async()=>{await command('configure',{q:Number($('q').value),fast:$('fast-initial').checked,tester:false});await command('start');});on('fast-btn',()=>command('fast',{value:!state.fast}));on('alarm-btn',()=>command('alert',{message:$('alarm-message').value}));on('finish',()=>command('finish'));
on('reset',async()=>{if(confirm('Clear this round? Download the CSV first.'))await command('reset');});
on('solo',()=>command('force_departure'));
$('room-select').onchange=()=>{room=$('room-select').value;sessionStorage.setItem('ares-room',room);state=null;epoch='';error();poll();};
on('export',async()=>{const r=await fetch('/api/export',{headers:{'X-Host-Key':key,'X-Mission-Room':room}});if(!r.ok)throw new Error('Export failed');const u=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=u;a.download='mars-mission.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});
on('project-toggle',()=>{const p=document.body.classList.toggle('present');$('project-toggle').textContent=p?'Exit projection':'Project QR';});
$('alarm-message').value=ALERT;
if(isHost){$('player').classList.add('hidden');$('host').classList.remove('hidden');poll();}else if(token)poll();else $('connection').textContent='● Ready to join';
setInterval(poll,800);

let noticeEpoch='',seenNotice=0,noticeQueue=[],noticeTimer=null,noticeTimers=new Set();
function resetNotices(){noticeEpoch='';seenNotice=0;noticeQueue=[];clearTimeout(noticeTimer);noticeTimer=null;noticeTimers.forEach(clearTimeout);noticeTimers.clear();$('departure-stack').replaceChildren();}
function notifyDepartures(s){if(noticeEpoch!==s.epoch){resetNotices();noticeEpoch=s.epoch;seenNotice=Number(sessionStorage.getItem('ares-notice-'+s.epoch)||0);}for(const e of s.events){if(e.id>seenNotice){noticeQueue.push(e);seenNotice=e.id;}}sessionStorage.setItem('ares-notice-'+s.epoch,String(seenNotice));showNotice();}
function showNotice(){if(noticeTimer||!noticeQueue.length||$('alert-dialog').open||$('return-dialog').open)return;
 noticeQueue.shift();const box=$('departure-stack'),banner=document.createElement('div');banner.className='departure-banner';const title=document.createElement('strong');title.textContent='AN ASTRONAUT HAS RETURNED HOME';banner.append(title);
 const later=(fn,ms)=>{const timer=setTimeout(()=>{noticeTimers.delete(timer);fn();},ms);noticeTimers.add(timer);};
 const dismiss=el=>{el.classList.add('leaving');later(()=>el.remove(),220);};
 const insert=()=>{box.prepend(banner);later(()=>dismiss(banner),4200);};
 if(box.children.length>=3){const oldest=box.lastElementChild;dismiss(oldest);later(insert,230);}else insert();
 if(navigator.vibrate)navigator.vibrate([100,60,100]);
 noticeTimer=setTimeout(()=>{noticeTimer=null;showNotice();},300);
}

function updateClock(){if(!state)return;const seconds=state.phase==='running'?Math.max(0,Math.ceil((state.deadline*1000-Date.now()-(state.clockOffset||0))/1000)):state.phase==='finished'?0:60;$('time-left').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');$('host-time-left').textContent=$('time-left').textContent;$('clock').classList.toggle('urgent',state.phase==='running'&&seconds<=15);if(!isHost&&seconds===0){$('stay').disabled=true;$('home').disabled=true;}}
setInterval(updateClock,200);

// Final cinematics are separate from the immediate departure journey.
let endingFrame=null,endingKey='';
function stopOutcome(){if(endingFrame!==null)cancelAnimationFrame(endingFrame);endingFrame=null;endingKey='';$('outcome-animation').classList.add('hidden');}
function playOutcome(s){
 const id='ares-ending-'+room+'-'+s.epoch+'-'+token;
 if(endingKey===id){if(endingFrame===null)$('arrival').classList.remove('hidden');return;}
 if(sessionStorage.getItem(id)==='seen'){$('arrival').classList.remove('hidden');return;}
 endingKey=id;sessionStorage.setItem(id,'seen');
 const returned=s.me.action==='home',failed=s.mission_failed,kind=!returned?(failed?'lost':'heroes'):(failed?'family':'disgrace');
 $('animation-caption').textContent={heroes:'You return with honour',family:'You saved yourself',lost:'You did not survive',disgrace:'You return in disgrace'}[kind];
 $('outcome-animation').classList.remove('hidden');
 const canvas=$('outcome-canvas'),c=canvas.getContext('2d'),began=performance.now();
 function frame(now){const t=Math.min(6,(now-began)/1000);drawEnding(c,t,kind);if(t<6){endingFrame=requestAnimationFrame(frame);}else{endingFrame=null;$('outcome-animation').classList.add('hidden');$('arrival').classList.remove('hidden');}}
 endingFrame=requestAnimationFrame(frame);
}
function drawEnding(c,t,kind){
 const W=720,H=480,clamp=v=>Math.max(0,Math.min(1,v)),ease=v=>{v=clamp(v);return v*v*(3-2*v);};
 c.setTransform(2,0,0,2,0,0);c.clearRect(0,0,W,H);c.fillStyle='#10161f';c.fillRect(0,0,W,H);
 const circle=(x,y,r,color)=>{c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();};
 const line=(x,y,a,b,color,w=4)=>{c.strokeStyle=color;c.lineWidth=w;c.lineCap='round';c.beginPath();c.moveTo(x,y);c.lineTo(a,b);c.stroke();};
 function text(str,x,y,size=16,color='#cad5df'){c.font=`600 ${size}px system-ui`;c.fillStyle=color;c.textAlign='center';c.fillText(str,x,y);}
 for(let i=0;i<65;i++)circle((i*137+19)%W,(i*73+11)%H,1+(i%3)*.35,'#596c83');
 function planet(x,y,r,earth){circle(x,y,r,earth?'#377fa7':'#ba6448');c.save();c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.clip();if(earth){circle(x-r*.3,y+r*.2,r*.5,'#7bbd99');circle(x+r*.6,y-r*.5,r*.6,'#7bbd99');}else{line(x-r,y+r*.3,x+r,y-r*.2,'#87442f',r*.12);line(x-r,y-r*.3,x+r,y-r*.7,'#d88b64',r*.1);}c.restore();}
 function person(x,y,scale=1,suit=true,arms=0,helmet=true){c.save();c.translate(x,y);c.scale(scale,scale);line(-8,22,-10,43,suit?'#dce6ed':'#637aa5',7);line(8,22,10,43,suit?'#dce6ed':'#637aa5',7);c.fillStyle=suit?'#e5ebed':'#f8a77f';c.fillRect(-13,-1,26,27);line(-13,5,-24,arms? -7:23,suit?'#e5ebed':'#f8a77f',7);line(13,5,24,arms?-7:23,suit?'#e5ebed':'#f8a77f',7);circle(0,-17,17,suit&&helmet?'#f3eee2':'#e6ae8c');if(suit&&helmet){circle(1,-18,11,'#284963');line(-4,-23,3,-25,'#8dd3e2',2);c.fillStyle='#f88057';c.fillRect(-7,7,14,7);}else{circle(-5,-20,2,'#392d2a');circle(5,-20,2,'#392d2a');}if(suit&&!helmet){c.fillStyle='#f88057';c.fillRect(-7,7,14,7);const lift=ease((t-4.2)/.75);circle(25*lift,-45+65*lift,17,'#f3eee2');circle(25*lift,-45+65*lift,11,'#284963');}c.restore();}
 function ship(x,y,scale=1,angle=0,flame=true){c.save();c.translate(x,y);c.rotate(angle);c.scale(scale,scale);if(flame){c.fillStyle='#ffad57';c.beginPath();c.moveTo(-16,15);c.lineTo(-50-Math.sin(t*40)*9,0);c.lineTo(-16,-15);c.fill();}c.fillStyle='#f88057';c.beginPath();c.moveTo(-20,-7);c.lineTo(-35,-28);c.lineTo(3,-14);c.lineTo(3,14);c.lineTo(-35,28);c.lineTo(-20,7);c.fill();c.fillStyle='#f3eee2';c.beginPath();c.ellipse(0,0,35,16,0,0,Math.PI*2);c.fill();circle(9,0,9,'#438ba6');c.restore();}
 if(kind==='lost'){
  planet(650,400,30,false);const q=ease(t/6);c.save();c.translate(300+120*q,205-50*q+Math.sin(t*1.4)*15);c.rotate(t*.45);person(0,0,2-q,true,1);c.restore();text('?',440,135+Math.sin(t*2)*8,30);text('Anyone…?',360,410,22);return;
 }
 // Returned players have already flown home. Only heroes replay the journey.
 if(kind==='family'&&t<1.6){
  planet(360,340,115,false);text('MARS BASE',360,110,18);c.fillStyle='#d7dce0';c.fillRect(320,207,80,30);circle(360,208,25,'#d7dce0');c.fillStyle='#4d7e91';c.fillRect(337,201,46,16);
  const p=clamp((t-.2)/1.25);if(t>.2){for(let i=0;i<20;i++){const a=i*2.4;circle(360+Math.cos(a)*p*140,210+Math.sin(a)*p*110,(8+22*p)*(1-p*.5),i%2?'#ffbd62':'#f86a45');}text('CRITICAL BASE FAILURE',360,440,18,'#ff9b85');}return;
 }
 if(kind==='family')t=t-1.6+3.4;
 if(kind==='disgrace')t=t+3.4;
 const landing=kind==='heroes'?ease((t-2.7)/.7):1;
 if(kind==='heroes'&&t<3.4){c.save();c.globalAlpha=1-landing;planet(120,290,72,false);text('MARS',120,390,14);planet(595,145,66,true);text('EARTH',595,245,14);const progress=ease(t/3.2);ship(175+390*progress,260-110*progress,.9,-.28);c.restore();}
 if(t>=2.7){c.save();c.globalAlpha=landing;
 c.fillStyle='#29483e';c.beginPath();c.ellipse(360,575,510,250,0,0,Math.PI*2);c.fill();text('EARTH',360,450,14,'#9fd2b3');
 if(kind==='heroes'){
  // Cheering spectators form two rows behind the arriving crew.
  for(let i=0;i<23;i++){const xx=55+i*28,yy=365+(i%2)*28+Math.sin(t*7+i)*4;person(xx,yy,.48,false,1);}
  for(let i=0;i<3;i++){const xx=465+i*70;person(xx,320,.75,false,0);c.fillStyle='#121923';c.fillRect(xx-19,294,30,17);circle(xx-21,302,8,'#50697d');if(Math.sin(t*13+i*3)>.85){circle(xx-26,300,13,'#fff4bd');}text('PRESS',xx,351,8);}
  line(430,339,416,316,'#46525e',3);circle(414,312,5,'#c8d4df');
 }
 ship(230,315,1.5,-Math.PI/2,false);line(210,355,190,380,'#d9e0e5',5);line(250,355,270,380,'#d9e0e5',5);
 const exit=ease((t-3.35)/.9),x=240+95*exit;person(x,340,1.05,true,kind==='heroes'?1:0,kind!=='family'||t<4.2);
 if(kind==='heroes'){
  person(390,342,.9,true,1);person(440,345,.85,true,1);
  if(t>4){for(let j=0;j<4;j++){const p=((t-4+j*.26)%1.25)/1.25,cx=140+j*145,cy=110+(j%2)*65;for(let i=0;i<14;i++){const a=i*Math.PI*2/14;c.globalAlpha=landing*(1-p);line(cx+Math.cos(a)*p*30,cy+Math.sin(a)*p*30,cx+Math.cos(a)*p*85,cy+Math.sin(a)*p*85,['#ffb76d','#9fd2b3','#c2b6ff','#fff2bd'][j],3);}}}
 }else if(kind==='family'){
  const hug=ease((t-3.7)/1.1);person(520-160*hug,342,1,false,1);person(570-203*hug,365,.65,false,1);
  person(x+105,355,.8,true,0,t<4.2);person(620-166*hug,356,.8,false,1);
  if(hug>.65){text('♥',350,270-Math.sin(t*3)*6,30,'#ff8e87');line(335,345,365,341,'#e5ebed',7);line(361,340,337,338,'#f8a77f',7);}
 }else{
  person(530,340,1,false,1);person(600,343,.9,false,1);
  if(t>4){for(let i=0;i<5;i++){const raw=(t-4-i*.18)/.75;if(raw<0)continue;const p=clamp(raw),tx=530-(195+i*2)*p,ty=323-95*Math.sin(p*Math.PI);circle(tx,ty,8,'#ed5145');line(tx-3,ty-6,tx+4,ty-10,'#74a765',3);if(p===1){for(let k=0;k<5;k++)circle(tx+Math.cos(k*2)*13,ty+Math.sin(k*2)*13,4,'#ed5145');}}}
 }
 c.restore();}
}
