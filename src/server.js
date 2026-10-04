import 'dotenv/config';
import express from 'express';
const app = express();
const PORT = process.env.PORT || 3000;

const BOT = process.env.BOT_TOKEN;
const CHAT = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID;
const KEY = process.env.ODDS_API_KEY;

// DATOS REALES DE COBRO - TRANSFERENCIA
const DATOS_BANCO = `
🏦 <b>DATOS TRANSFERENCIA</b>
<b>Banco:</b> Copec Pay
<b>Tipo:</b> Cuenta Vista
<b>N° Cuenta:</b> 12880008101
<b>Titular:</b> Jorge Arley García Cuesta
<b>RUT:</b> 28.800.081-6
<b>Email:</b> sebastiangarcfran1@gmail.com
<b>Monto:</b> $5.000
`.trim();

const LIGAS_FIJAS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_argentina_primera_division',
  'soccer_brazil_campeonato',
  'soccer_chile_campeonato',
  'soccer_conmebol_copa_libertadores'
];

let historial = new Map();
let enviadas = new Set();
let pendientes = new Map();
let pagados = new Set((process.env.PAID_USERS||"").split(",").map(s=>s.trim()).filter(Boolean));

async function enviar(texto){
  try{
    await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:CHAT, text:texto, parse_mode:'HTML'})
    });
  }catch(e){ console.log(e.message) }
}

async function escanearTodo(){
  let totalPartidos=0, totalCuotas=0, alertas=[];
  for(const liga of LIGAS_FIJAS){
    try{
      const url=`https://api.the-odds-api.com/v4/sports/${liga}/odds/?apiKey=${KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
      const res=await fetch(url);
      if(!res.ok) continue;
      const partidos=await res.json();
      totalPartidos+=partidos.length;
      for(const p of partidos){
        for(const book of p.bookmakers||[]){
          for(const m of book.markets||[]){
            for(const out of m.outcomes||[]){
              totalCuotas++;
              const key=`${p.id}_${out.name}`;
              const ant=historial.get(key);
              if(ant){
                const caida=((ant-out.price)/ant)*100;
                if(caida>=3.5 &&!enviadas.has(key)){
                  alertas.push({liga,p,book,out,anterior:ant,caida:caida.toFixed(1)});
                  enviadas.add(key);
                  setTimeout(()=>enviadas.delete(key), 2*60*60*1000);
                }
              }
              historial.set(key,out.price);
            }
          }
        }
      }
    }catch{}
  }
  return {totalPartidos,totalCuotas,alertas};
}

async function checkValor(){
  const {alertas}=await escanearTodo();
  if(!alertas.length) return;
  const a=alertas[0];
  const nivel=a.caida>=8?"🟠 VALOR ALTO":"🟡 VALOR MEDIO";
  const pais=a.liga.includes('epl')?'🏴󐁧󐁢󐁥󐁮󐁧󐁿':a.liga.includes('spain')?'🇪🇸':a.liga.includes('argentina')?'🇦🇷':a.liga.includes('brazil')?'🇧🇷':'🏆';
  await enviar(`🚨 <b>ALERTA DE VALOR VIP</b> 🚨\n📉 <b>¡CAÍDA ${a.caida}% DETECTADA!</b>\n\n🏆 <b>${a.liga.replace('soccer_','').replace(/_/g,' ').toUpperCase()}</b> ${pais}\n⚽ <b>${a.p.home_team} vs ${a.p.away_team}</b>\n\n🎯 <b>Mercado:</b> ${a.out.name}\n💰 <b>Cuota:</b> ${a.anterior.toFixed(2)} → <b>${a.out.price}</b>\n📊 <b>Nivel:</b> ${nivel}\n\n⏰ ${new Date().toLocaleTimeString('es-CL')}\n<i>El mercado se está moviendo fuerte. Posible oportunidad de valor.</i>\n\n⚠️ <i>Solo info estadística. +18 Juega responsable</i>`);
}

async function radarActivo(){
  const {totalPartidos,totalCuotas}=await escanearTodo();
  const hora=new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',hour12:true});
  await enviar(`📡 <b>Radar Activo ${hora}</b>\nEscaneando ${totalPartidos} partidos en ${LIGAS_FIJAS.length} ligas...\n${totalCuotas} cuotas en seguimiento\nSin movimientos >8% por ahora. Próximo escaneo en 3 min.`);
}

async function previaCaliente(){
  await enviar(`🔥 <b>PREVIA CALIENTE SUDAMÉRICA + EUROPA ACTIVO</b> 🔥\n\n🏆 6 Ligas: Premier 🏴󐁧󐁢󐁥󐁮󐁧󐁿 LaLiga 🇪🇸 Arg 🇦🇷 Bra 🇧🇷 Chi 🇨🇱 Libertadores 🏆\n⏰ ${new Date().toLocaleTimeString('es-CL')}\n<i>Bot 100% operativo</i>`);
}

// SISTEMA 10 MIN + TRANSFERENCIA COPEC
async function banUser(userId){
  await fetch(`https://api.telegram.org/bot${BOT}/banChatMember`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:CHAT, user_id:userId})
  });
  setTimeout(async()=>{
    await fetch(`https://api.telegram.org/bot${BOT}/unbanChatMember`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:CHAT, user_id:userId, only_if_banned:true})
    });
  },1500);
}

async function checkNuevosUsuarios(){
  try{
    const r=await fetch(`https://api.telegram.org/bot${BOT}/getUpdates?timeout=0`);
    const d=await r.json();
    if(!d.ok) return;
    let lastId=null;
    for(const u of d.result){
      lastId=u.update_id;
      if(u.message && u.message.new_chat_members){
        for(const m of u.message.new_chat_members){
          if(m.is_bot) continue;
          const id=String(m.id);
          if(pagados.has(id) || pendientes.has(id)) continue;
          pendientes.set(id, {nombre:m.first_name, time:Date.now()});
          await enviar(`👋 ¡Bienvenido <b>${m.first_name}</b> a Alerta Valor VIP! 🚀\n\n🎁 <b>Tienes 10 MINUTOS GRATIS</b> para probar el radar.\n\n💳 <b>Para quedarte, transfiere $5.000 a:</b>\n${DATOS_BANCO}\n\n📲 Después envía el comprobante a sebastiangarcfran1@gmail.com y serás agregado.\n\n⏳ Si no pagas, serás expulsado automáticamente en 10 min.`);
        }
      }
    }
    if(lastId) await fetch(`https://api.telegram.org/bot${BOT}/getUpdates?offset=${lastId+1}`);

    const ahora=Date.now();
    for(const [uid, data] of pendientes.entries()){
      const min=(ahora-data.time)/1000/60;
      if(min>=9 && min<9.5){
        await enviar(`⚠️ <b>${data.nombre}</b> te queda 1 minuto para pagar o serás expulsado.\n\n${DATOS_BANCO}\n\nSi ya pagaste ignora este mensaje.`);
      }
      if(min>=10){
        if(!pagados.has(uid)){
          await enviar(`💀 <b>${data.nombre}</b> expulsado por no pagar membresía de $5.000.\n\n${DATOS_BANCO}\n\nPaga y vuelve a entrar.`);
          await banUser(uid);
        }
        pendientes.delete(uid);
      }
    }
  }catch(e){ console.log(e.message) }
}

async function cobrarMensualidad(){
  await enviar(`💳 <b>RENOVACIÓN MENSUAL - ALERTA VALOR VIP</b>\n\nHola equipo! 👋\n\nTu membresía de $5.000 vence pronto.\n\nTransfiere a:\n${DATOS_BANCO}\n\nEnvía comprobante al admin para seguir dentro.\n\n❌ Los que no renueven serán expulsados.\n\nGracias por ser VIP! 🚀`);
}

app.get('/', (req,res)=>res.send('Bot FINAL OK - Radar + 6 ligas + Copec + 10min'));
app.get('/cobrar', async (req,res)=>{ await cobrarMensualidad(); res.send('Cobro enviado'); });

app.listen(PORT, async ()=>{
  console.log(`🚀 FINAL en ${PORT} - 6 ligas`);
  await enviar(`✅ <b>Bot FINAL Activo</b>\n📡 Radar 6 ligas: Premier + LaLiga + Sudamérica\n💳 Cobro: Copec Pay 12880008101 - Jorge Arley García Cuesta 28.800.081-6\n⏱️ Expulsión 10 min ACTIVA\n⏰ ${new Date().toLocaleTimeString('es-CL')}`);
  await radarActivo();
  setTimeout(checkValor, 10*1000);
  setInterval(checkValor, 3*60*1000);
  setInterval(radarActivo, 3*60*1000);
  setInterval(previaCaliente, 15*60*1000);
  setInterval(checkNuevosUsuarios, 30*1000);
});
