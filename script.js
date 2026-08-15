/* ============================= CONFIG & API ============================= */
// GANTI URL INI DENGAN WEB APP URL DARI GOOGLE APPS SCRIPT KAMU
const API_URL = "https://script.google.com/macros/s/AKfycbxtWBLRQALTuqgXhGxnAD2oM7Wu8aQiYzbkTLkY79-BjBhRziiS86ZNe0MSvieK9vD6/exec";

/* ============================= DATA & STORAGE ============================= */
const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const GROUP_LABEL = {income:"Pemasukan",saving:"Tabungan",fixed:"Fixed Cost",variable:"Variable Cost",subscription:"Langganan&Hutang",mutasi:"Mutasi"};
const uid = () => Math.random().toString(36).slice(2,10);
const rp = n => "Rp" + Math.round(n||0).toLocaleString('id-ID');

let state = null;
let saveTimer = null;
let editingLedgerId = null;

function queueSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    try {
      await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
      console.log("Data berhasil disinkronkan ke Google Sheets");
    } catch(e) {
      console.error("Gagal menyimpan ke Google Sheets", e);
    }
  }, 500);
}

function defaultState(){
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  return {
    period: ym,
    groqApiKey: '',
    categories: [
      {id:uid(), group:'income', name:'Gaji Suami', tipe:'Utama'},
      {id:uid(), group:'income', name:'Gaji Istri', tipe:'Utama'},
      {id:uid(), group:'income', name:'Bisnis Sampingan', tipe:'Sampingan'},
      {id:uid(), group:'income', name:'Sisa Bulan Lalu', tipe:'Lainnya'},
      {id:uid(), group:'saving', name:'Dana Darurat', jenis:'Tunai/Bank', target:20000000},
      {id:uid(), group:'saving', name:'Tabungan Emas/Bibit', jenis:'Emas', target:10000000},
      {id:uid(), group:'saving', name:'Beli Rumah', jenis:'Tunai/Bank', target:200000000},
      {id:uid(), group:'fixed', name:'Tempat Tinggal', prioritas:'High'},
      {id:uid(), group:'fixed', name:'Kirim Orang Tua', prioritas:'Medium'},
      {id:uid(), group:'fixed', name:'Transportasi Kerja', prioritas:'Medium'},
      {id:uid(), group:'variable', name:'Pengeluaran Sehari-hari', prioritas:'High'},
      {id:uid(), group:'variable', name:'Jajan & Nongkrong', prioritas:'Medium'},
      {id:uid(), group:'subscription', name:'Langganan Digital', prioritas:'Medium'},
    ],
    budgets: {},
    ledger: []
  };
}

async function loadState(){
  try {
    const res = await fetch(API_URL);
    if(res.ok) {
      const data = await res.json();
      if(data && data.categories && data.categories.length > 0) {
        state = data;
      } else {
        state = defaultState();
      }
    } else {
      state = defaultState();
    }
  } catch(e) {
    console.error("Gagal memuat dari Google Sheets, menggunakan default state", e);
    state = defaultState();
  }
  if(!state.budgets) state.budgets = {};
  if(!state.ledger) state.ledger = [];
  if(!state.categories) state.categories = [];
  if(!state.groqApiKey) state.groqApiKey = '';
}

/* ============================= AUTH ============================= */
async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function randomSalt(){
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function loadFamilyAuth(){
  try{
    const res = localStorage.getItem('family-auth');
    return res ? JSON.parse(res) : null;
  }catch(e){ return null; }
}
async function saveFamilyAuth(obj){
  try{ localStorage.setItem('family-auth', JSON.stringify(obj)); }
  catch(e){ console.error('failed to save family auth', e); }
}
function showAuthForm(which){
  document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
  document.querySelectorAll('.auth-tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.authtab===which.replace('auth-','')));
  document.getElementById(which).classList.add('active');
}
document.querySelectorAll('.auth-tab-btn').forEach(btn=>{
  btn.onclick = async ()=>{
    showAuthForm('auth-'+btn.dataset.authtab);
    if(btn.dataset.authtab==='setup') await refreshSetupTab();
  };
});
async function refreshSetupTab(){
  const auth = await loadFamilyAuth();
  document.getElementById('setup-fields').style.display = auth ? 'none' : 'block';
  document.getElementById('setup-already-exists').style.display = auth ? 'block' : 'none';
}

document.getElementById('setup-submit').onclick = async ()=>{
  const familyId = document.getElementById('setup-familyid').value.trim();
  const pw = document.getElementById('setup-password').value;
  const pw2 = document.getElementById('setup-password2').value;
  const errEl = document.getElementById('setup-error');
  errEl.style.display='none';
  if(!familyId){ errEl.textContent='ID Keluarga wajib diisi.'; errEl.style.display='block'; return; }
  if(!pw){ errEl.textContent='Kata sandi wajib diisi.'; errEl.style.display='block'; return; }
  if(pw.length < 4){ errEl.textContent='Kata sandi minimal 4 karakter.'; errEl.style.display='block'; return; }
  if(pw !== pw2){ errEl.textContent='Kata sandi dan pengulangannya tidak sama.'; errEl.style.display='block'; return; }
  const salt = randomSalt();
  const hash = await sha256Hex(salt+pw);
  await saveFamilyAuth({familyId, salt, hash});
  await enterApp(familyId);
};

document.getElementById('login-submit').onclick = async ()=>{
  const familyId = document.getElementById('login-familyid').value.trim();
  const pw = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display='none';
  if(!familyId || !pw){ errEl.textContent='Isi ID Keluarga dan kata sandi.'; errEl.style.display='block'; return; }
  const auth = await loadFamilyAuth();
  if(!auth){
    errEl.textContent='Belum ada akun keluarga. Silakan buat dulu lewat tab "Buat Akun".';
    errEl.style.display='block';
    return;
  }
  if(familyId.toLowerCase() !== auth.familyId.toLowerCase()){ errEl.textContent='ID Keluarga tidak ditemukan.'; errEl.style.display='block'; return; }
  const hash = await sha256Hex(auth.salt+pw);
  if(hash !== auth.hash){ errEl.textContent='Kata sandi salah. Coba lagi.'; errEl.style.display='block'; return; }
  await enterApp(auth.familyId);
};

document.getElementById('forgotLink').onclick = ()=>{
  document.getElementById('forgotBox').style.display = document.getElementById('forgotBox').style.display==='none' ? 'block' : 'none';
};
document.getElementById('forgot-submit').onclick = async ()=>{
  if(document.getElementById('forgot-confirm').value.trim() !== 'RESET'){ alert('Ketik RESET (huruf kapital) untuk konfirmasi.'); return; }
  try{ localStorage.removeItem('family-auth'); }catch(e){}
  document.getElementById('forgotBox').style.display='none';
  document.getElementById('login-password').value='';
  document.getElementById('login-familyid').value='';
  showAuthForm('auth-setup');
  await refreshSetupTab();
};

['login-familyid','login-password'].forEach(id=>document.getElementById(id).addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('login-submit').click(); }));
['setup-familyid','setup-password','setup-password2'].forEach(id=>document.getElementById(id).addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('setup-submit').click(); }));

// FUNGSI INI DIPERBARUI AGAR MENAMPILKAN LOADING SAAT LOGIN
async function enterApp(familyId){
  // 1. Tampilkan Loading Screen
  const loader = document.getElementById('globalLoading');
  loader.style.display = 'flex';
  
  // Berikan sedikit jeda sebelum memudarkan transparansi (efek transisi)
  setTimeout(async () => {
    loader.style.opacity = '1';
    
    // 2. Sembunyikan layar Autentikasi/Login
    document.getElementById('authScreen').style.display='none';
    
    // 3. Tarik data dari Google Sheets (Proses di balik layar)
    await loadState();
    
    // 4. Inisialisasi komponen UI Dashboard
    document.getElementById('familyIdLabel').textContent = '👪 ' + (familyId || '');
    document.getElementById('lockBtn').onclick = lockApp;
    initPeriodPickers();
    initLedgerForm();
    initLedgerFilters();
    initScanPanel();
    
    // 5. Hilangkan Loading Screen dan tampilkan Dashboard utama
    setTimeout(() => {
      loader.style.opacity = '0'; // Pudar perlahan
      setTimeout(() => {
        loader.style.display = 'none';
        document.getElementById('appShell').style.display='block';
        renderAll();
      }, 400); // Waktu pudarnya sesuai CSS (0.4 detik)
    }, 800); // Durasi minimal loading terlihat di layar agar cantik
  }, 10);
}

function lockApp(){
  state = null;
  document.getElementById('appShell').style.display='none';
  document.getElementById('authScreen').style.display='flex';
  document.getElementById('login-password').value='';
  showAuthForm('auth-login');
}

/* ============================= HELPERS ============================= */
function catsByGroup(g){ return state.categories.filter(c=>c.group===g); }
function catName(id){ const c = state.categories.find(c=>c.id===id); return c? c.name : '(dihapus)'; }
function budgetFor(period, catId){ return (state.budgets[period] && state.budgets[period][catId]) || 0; }
function setBudget(period, catId, val){
  if(!state.budgets[period]) state.budgets[period] = {};
  state.budgets[period][catId] = val;
  queueSave();
}
function ledgerInPeriod(period, group){
  return state.ledger.filter(t=> t.date && t.date.slice(0,7)===period && (!group || t.group===group));
}
function actualForCategory(period, catId){
  return state.ledger.filter(t=>t.date.slice(0,7)===period && t.categoryId===catId)
    .reduce((s,t)=>s+Number(t.amount||0),0);
}
function groupTotalActual(period, group){
  return catsByGroup(group).reduce((s,c)=>s+actualForCategory(period,c.id),0);
}
function groupTotalBudget(period, group){
  return catsByGroup(group).reduce((s,c)=>s+budgetFor(period,c.id),0);
}
function incomeTotal(period){
  return ledgerInPeriod(period,'income').reduce((s,t)=>s+Number(t.amount||0),0);
}
function lifetimeSavedForCategory(catId){
  return state.ledger.filter(t=>t.group==='saving' && t.categoryId===catId).reduce((s,t)=>s+Number(t.amount||0),0);
}
function accountBalances(){
  let bank=0, cash=0;
  state.ledger.forEach(t=>{
    if(t.group==='mutasi'){
      if(t.arah==='bank-cash'){ bank -= Number(t.amount||0); cash += Number(t.amount||0); }
      else { cash -= Number(t.amount||0); bank += Number(t.amount||0); }
    } else {
      const sign = t.group==='income' ? 1 : -1;
      if(t.akun==='bank') bank += sign*Number(t.amount||0);
      else cash += sign*Number(t.amount||0);
    }
  });
  return {bank, cash, total: bank+cash};
}

/* ============================= PERIOD PICKER ============================= */
function initPeriodPickers(){
  const mSel = document.getElementById('monthSelect');
  const ySel = document.getElementById('yearSelect');
  mSel.innerHTML = MONTHS.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
  const years = new Set(state.ledger.map(t=>Number(t.date.slice(0,4))));
  const curYear = Number(state.period.slice(0,4));
  years.add(curYear); years.add(new Date().getFullYear());
  const sortedYears = [...years].sort((a,b)=>a-b);
  ySel.innerHTML = sortedYears.map(y=>`<option value="${y}">${y}</option>`).join('');
  mSel.value = Number(state.period.slice(5,7))-1;
  ySel.value = curYear;
  mSel.onchange = ()=>{ syncPeriod(); renderAll(); };
  ySel.onchange = ()=>{ syncPeriod(); renderAll(); };
}
function syncPeriod(){
  const m = Number(document.getElementById('monthSelect').value)+1;
  const y = document.getElementById('yearSelect').value;
  state.period = `${y}-${String(m).padStart(2,'0')}`;
  queueSave();
}

/* ============================= TABS ============================= */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-'+btn.dataset.tab).classList.add('active');
    renderAll();
  };
});

document.querySelectorAll('.toggle-btn').forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll('.toggle-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.dash-sub').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('dash-'+btn.dataset.dashview).classList.add('active');
    renderAll();
  };
});

/* ============================= CHARTS ============================= */
let charts = {};
function upsertChart(id, config){
  if(charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id).getContext('2d');
  charts[id] = new Chart(ctx, config);
}
const PALETTE = ['#204A2C','#6F9A6A','#D6A24C','#8C2A5D','#2A5D8C','#C24C42','#5D2A8C','#9ab293'];

function yearlyIncomeTotal(year){
  let t=0; for(let m=1;m<=12;m++) t+=incomeTotal(`${year}-${String(m).padStart(2,'0')}`); return t;
}
function yearlyGroupActual(year, group){
  let t=0; for(let m=1;m<=12;m++) t+=groupTotalActual(`${year}-${String(m).padStart(2,'0')}`, group); return t;
}
function yearlyGroupBudget(year, group){
  let t=0; for(let m=1;m<=12;m++) t+=groupTotalBudget(`${year}-${String(m).padStart(2,'0')}`, group); return t;
}
function yearlyCategoryActual(year, catId){
  let t=0; for(let m=1;m<=12;m++) t+=actualForCategory(`${year}-${String(m).padStart(2,'0')}`, catId); return t;
}

/* ============================= RENDER: DASHBOARD ============================= */
function renderDashboard(){
  const p = state.period;
  const inc = incomeTotal(p);
  const savedNow = groupTotalActual(p,'saving');
  const fixedA = groupTotalActual(p,'fixed');
  const varA = groupTotalActual(p,'variable');
  const subA = groupTotalActual(p,'subscription');
  const totalExpense = fixedA+varA+subA;
  const remaining = inc - totalExpense - savedNow;

  document.getElementById('kpi-income').textContent = rp(inc);
  document.getElementById('kpi-remaining').textContent = rp(remaining);
  document.getElementById('kpi-saved').textContent = rp(savedNow);
  document.getElementById('kpi-expense').textContent = rp(totalExpense);
  document.getElementById('kpi-daily').textContent = rp(varA);

  upsertChart('chartIncomeExpense', {
    type:'bar',
    data:{labels:['Pendapatan','Pengeluaran'], datasets:[{data:[inc,totalExpense], backgroundColor:['#6F9A6A','#C24C42'], borderRadius:8}]},
    options:{plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>rp(v)}}}}
  });

  const totalBudget = groupTotalBudget(p,'saving')+groupTotalBudget(p,'fixed')+groupTotalBudget(p,'variable')+groupTotalBudget(p,'subscription');
  const totalActualBSF = savedNow+totalExpense;
  upsertChart('chartPlanActual', {
    type:'bar',
    data:{labels:['Rencana','Aktual'], datasets:[{data:[totalBudget,totalActualBSF], backgroundColor:['#DCEBD8','#204A2C'], borderRadius:8}]},
    options:{plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>rp(v)}}}}
  });

  const incomeCats = catsByGroup('income');
  const incomeData = incomeCats.map(c=>actualForCategory(p,c.id));
  upsertChart('chartIncomeDonut',{
    type:'doughnut',
    data:{labels:incomeCats.map(c=>c.name), datasets:[{data:incomeData, backgroundColor:PALETTE}]},
    options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}}}}
  });

  const saveCats = catsByGroup('saving');
  const saveData = saveCats.map(c=>actualForCategory(p,c.id));
  upsertChart('chartSavingDonut',{
    type:'doughnut',
    data:{labels:saveCats.map(c=>c.name), datasets:[{data:saveData, backgroundColor:PALETTE}]},
    options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}}}}
  });

  upsertChart('chartExpenseGroups',{
    type:'bar',
    data:{labels:['Fixed Cost','Variable Cost','Subscription & Debt'], datasets:[{data:[fixedA,varA,subA], backgroundColor:['#2A5D8C','#8C2A5D','#5D2A8C'], borderRadius:8}]},
    options:{plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>rp(v)}}}}
  });

  const groups = [['saving','Tabungan'],['fixed','Fixed Cost'],['variable','Variable Cost'],['subscription','Subs & Debt']];
  const planData = groups.map(g=>groupTotalBudget(p,g[0]));
  const actData = groups.map(g=>groupTotalActual(p,g[0]));
  const actColors = groups.map((g,i)=>{
    if(g[0]==='saving') return actData[i] < planData[i] ? '#C24C42' : '#D6A24C';
    return actData[i] > planData[i] ? '#C24C42' : '#204A2C';
  });
  upsertChart('chartVariance',{
    type:'bar',
    data:{
      labels:groups.map(g=>g[1]),
      datasets:[
        {label:'Rencana', data:planData, backgroundColor:'#DCEBD8', borderRadius:6},
        {label:'Aktual', data:actData, backgroundColor:actColors, borderRadius:6}
      ]
    },
    options:{
      plugins:{
        legend:{position:'bottom'},
        tooltip:{callbacks:{label:(ctx)=>ctx.dataset.label+': '+rp(ctx.raw)}},
        datalabels:{}
      },
      scales:{y:{ticks:{callback:v=>rp(v)}}}
    },
    plugins:[{
      id:'varLabel',
      afterDatasetsDraw(chart){
        const {ctx} = chart;
        groups.forEach((g,i)=>{
          const diff = actData[i]-planData[i];
          const pct = planData[i]? Math.round((actData[i]/planData[i])*100) : 0;
          const meta = chart.getDatasetMeta(1);
          const bar = meta.data[i];
          if(!bar) return;
          ctx.save();
          ctx.font='700 10px Inter'; ctx.textAlign='center';
          ctx.fillStyle = diff>0 ? '#C24C42' : '#204A2C';
          const sign = diff>0?'+':'';
          ctx.fillText(`${sign}${rp(diff)} (${pct}%)`, bar.x, bar.y-8);
          ctx.restore();
        });
      }
    }]
  });

  renderIncomeTable(p);
  renderPlanTable('saving','tbl-saving',p);
  renderPlanTable('fixed','tbl-fixed',p);
  renderPlanTable('variable','tbl-variable',p);
  renderPlanTable('subscription','tbl-subscription',p);
}

function renderIncomeTable(p){
  const cats = catsByGroup('income');
  let total = 0;
  let html = cats.map(c=>{
    const val = actualForCategory(p,c.id); total+=val;
    return `<tr><td>${esc(c.name)}</td><td><span class="badge ${c.tipe}">${c.tipe}</span></td><td class="num">${rp(val)}</td></tr>`;
  }).join('');
  html += `<tr class="total-row"><td colspan="2">TOTAL</td><td class="num">${rp(total)}</td></tr>`;
  document.getElementById('tbl-income').innerHTML = html || '<tr><td colspan="3" style="text-align:center;color:#9ab293;">Belum ada sumber pendapatan</td></tr>';
}

function renderPlanTable(group, elId, p){
  const cats = catsByGroup(group);
  let tb=0, ta=0;
  let html = cats.map(c=>{
    const b = budgetFor(p,c.id); const a = actualForCategory(p,c.id);
    tb+=b; ta+=a;
    let overClass = '';
    if(group==='saving'){ overClass = (a < b) ? 'under-target' : 'ok'; }
    else { overClass = (a > b) ? 'over' : 'ok'; }
    
    const badgeLabel = group === 'saving' ? (c.jenis || 'Tunai/Bank') : (c.prioritas || '-');
    const badgeClass = group === 'saving' ? 'Optional' : (c.prioritas || 'Medium');

    return `<tr><td>${esc(c.name)}</td><td><span class="badge ${badgeClass}">${badgeLabel}</span></td><td class="num">${rp(b)}</td><td class="num ${overClass}">${rp(a)}</td></tr>`;
  }).join('');
  html += `<tr class="total-row"><td colspan="2">TOTAL</td><td class="num">${rp(tb)}</td><td class="num">${rp(ta)}</td></tr>`;
  document.getElementById(elId).innerHTML = html || '<tr><td colspan="4" style="text-align:center;color:#9ab293;">Belum ada kategori</td></tr>';
}

function esc(s){ return String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function renderYearlyDashboard(){
  const year = Number(document.getElementById('yearSelect').value) || Number(state.period.slice(0,4));
  const inc = yearlyIncomeTotal(year);
  const savedY = yearlyGroupActual(year,'saving');
  const fixedY = yearlyGroupActual(year,'fixed');
  const varY = yearlyGroupActual(year,'variable');
  const subY = yearlyGroupActual(year,'subscription');
  const totalExpenseY = fixedY+varY+subY;
  const remainingY = inc - totalExpenseY - savedY;

  document.getElementById('ykpi-income').textContent = rp(inc);
  document.getElementById('ykpi-remaining').textContent = rp(remainingY);
  document.getElementById('ykpi-saved').textContent = rp(savedY);
  document.getElementById('ykpi-expense').textContent = rp(totalExpenseY);
  document.getElementById('ykpi-avg').textContent = rp(totalExpenseY/12);

  const incArr=[], expArr=[], savArr=[];
  for(let m=1;m<=12;m++){
    const p = `${year}-${String(m).padStart(2,'0')}`;
    incArr.push(incomeTotal(p));
    savArr.push(groupTotalActual(p,'saving'));
    expArr.push(groupTotalActual(p,'fixed')+groupTotalActual(p,'variable')+groupTotalActual(p,'subscription'));
  }
  upsertChart('chartYearlyTrend',{
    type:'line',
    data:{labels:MONTHS.map(m=>m.slice(0,3)), datasets:[
      {label:'Pendapatan', data:incArr, borderColor:'#204A2C', backgroundColor:'#204A2C', tension:.3},
      {label:'Pengeluaran', data:expArr, borderColor:'#C24C42', backgroundColor:'#C24C42', tension:.3},
      {label:'Ditabung', data:savArr, borderColor:'#D6A24C', backgroundColor:'#D6A24C', tension:.3},
    ]},
    options:{plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>rp(v)}}}}
  });

  const incomeCats = catsByGroup('income');
  upsertChart('chartIncomeDonutYear',{
    type:'doughnut',
    data:{labels:incomeCats.map(c=>c.name), datasets:[{data:incomeCats.map(c=>yearlyCategoryActual(year,c.id)), backgroundColor:PALETTE}]},
    options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}}}}
  });
  const saveCats = catsByGroup('saving');
  upsertChart('chartSavingDonutYear',{
    type:'doughnut',
    data:{labels:saveCats.map(c=>c.name), datasets:[{data:saveCats.map(c=>yearlyCategoryActual(year,c.id)), backgroundColor:PALETTE}]},
    options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}}}}
  });
  upsertChart('chartExpenseGroupsYear',{
    type:'bar',
    data:{labels:['Fixed Cost','Variable Cost','Subscription & Debt'], datasets:[{data:[fixedY,varY,subY], backgroundColor:['#2A5D8C','#8C2A5D','#5D2A8C'], borderRadius:8}]},
    options:{plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>rp(v)}}}}
  });

  const groups = [['saving','Tabungan'],['fixed','Fixed Cost'],['variable','Variable Cost'],['subscription','Subs & Debt']];
  const planData = groups.map(g=>yearlyGroupBudget(year,g[0]));
  const actData = groups.map(g=>yearlyGroupActual(year,g[0]));
  const actColors = groups.map((g,i)=>{
    if(g[0]==='saving') return actData[i] < planData[i] ? '#C24C42' : '#D6A24C';
    return actData[i] > planData[i] ? '#C24C42' : '#204A2C';
  });
  upsertChart('chartVarianceYear',{
    type:'bar',
    data:{labels:groups.map(g=>g[1]), datasets:[
      {label:'Rencana', data:planData, backgroundColor:'#DCEBD8', borderRadius:6},
      {label:'Aktual', data:actData, backgroundColor:actColors, borderRadius:6}
    ]},
    options:{plugins:{legend:{position:'bottom'}, tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+rp(ctx.raw)}}}, scales:{y:{ticks:{callback:v=>rp(v)}}}},
    plugins:[{
      id:'varLabelY',
      afterDatasetsDraw(chart){
        const {ctx} = chart;
        groups.forEach((g,i)=>{
          const diff = actData[i]-planData[i];
          const pct = planData[i]? Math.round((actData[i]/planData[i])*100) : 0;
          const meta = chart.getDatasetMeta(1);
          const bar = meta.data[i];
          if(!bar) return;
          ctx.save();
          ctx.font='700 10px Inter'; ctx.textAlign='center';
          ctx.fillStyle = diff>0 ? '#C24C42' : '#204A2C';
          const sign = diff>0?'+':'';
          ctx.fillText(`${sign}${rp(diff)} (${pct}%)`, bar.x, bar.y-8);
          ctx.restore();
        });
      }
    }]
  });

  document.getElementById('tbl-yearly-months').innerHTML = MONTHS.map((m,i)=>{
    const remain = incArr[i]-expArr[i]-savArr[i];
    return `<tr><td>${m}</td><td class="num">${rp(incArr[i])}</td><td class="num">${rp(expArr[i])}</td><td class="num">${rp(savArr[i])}</td><td class="num">${rp(remain)}</td></tr>`;
  }).join('');
}

/* ============================= RENDER: LEDGER ============================= */
function initLedgerForm(){
  document.getElementById('lf-date').value = new Date().toISOString().slice(0,10);
  const grpSel = document.getElementById('lf-group');
  grpSel.onchange = updateLedgerFormFields;
  updateLedgerFormFields();
  document.getElementById('lf-submit').onclick = addLedgerEntry;
}

function updateLedgerFormFields(){
  const g = document.getElementById('lf-group').value;
  const catWrap = document.getElementById('lf-cat-wrap');
  const akunWrap = document.getElementById('lf-akun-wrap');
  const arahWrap = document.getElementById('lf-arah-wrap');
  if(g==='mutasi'){
    catWrap.style.display='none'; akunWrap.style.display='none'; arahWrap.style.display='block';
  } else {
    catWrap.style.display='block'; akunWrap.style.display='block'; arahWrap.style.display='none';
    const sel = document.getElementById('lf-category');
    sel.innerHTML = catsByGroup(g).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">(belum ada kategori)</option>';
  }
}

function addLedgerEntry(){
  const date = document.getElementById('lf-date').value;
  const group = document.getElementById('lf-group').value;
  const amount = Number(document.getElementById('lf-amount').value);
  const note = document.getElementById('lf-note').value.trim();
  if(!date || !amount){ alert('Isi tanggal dan jumlah terlebih dahulu.'); return; }
  
  let entryData = {date, group, amount, note};
  if(group==='mutasi'){
    entryData.arah = document.getElementById('lf-arah').value;
    entryData.note = note || (entryData.arah==='bank-cash' ? 'Mutasi Rekening ke Cash' : 'Mutasi Cash ke Rekening');
  } else {
    entryData.categoryId = document.getElementById('lf-category').value;
    entryData.akun = document.getElementById('lf-akun').value;
    if(!entryData.categoryId){ alert('Tambahkan kategori terlebih dahulu di tab Budgeting.'); return; }
  }

  if (editingLedgerId) {
    const index = state.ledger.findIndex(t => t.id === editingLedgerId);
    if(index !== -1) {
      state.ledger[index] = { ...state.ledger[index], ...entryData };
    }
  } else {
    entryData.id = uid();
    state.ledger.push(entryData);
  }
  
  queueSave();
  cancelEditLedger(); 
  initPeriodPickers();
  renderAll();
}

function editLedgerEntry(id) {
  const entry = state.ledger.find(t => t.id === id);
  if(!entry) return;
  
  editingLedgerId = id;
  
  document.getElementById('lf-date').value = entry.date;
  document.getElementById('lf-group').value = entry.group;
  updateLedgerFormFields();
  
  if(entry.group === 'mutasi') {
    document.getElementById('lf-arah').value = entry.arah || 'bank-cash';
  } else {
    document.getElementById('lf-category').value = entry.categoryId || '';
    document.getElementById('lf-akun').value = entry.akun || 'cash';
  }
  
  document.getElementById('lf-amount').value = entry.amount;
  document.getElementById('lf-note').value = entry.note || '';
  
  const submitBtn = document.getElementById('lf-submit');
  submitBtn.textContent = '💾 Simpan Edit';
  submitBtn.style.backgroundColor = '#D6A24C';
  
  let cancelBtn = document.getElementById('lf-cancel-btn');
  if(!cancelBtn) {
    cancelBtn = document.createElement('button');
    cancelBtn.id = 'lf-cancel-btn';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.style.width = '100%';
    cancelBtn.style.marginTop = '8px';
    cancelBtn.textContent = 'Batal Edit';
    cancelBtn.onclick = cancelEditLedger;
    submitBtn.parentNode.appendChild(cancelBtn);
  }
  cancelBtn.style.display = 'block';
  
  document.getElementById('ledgerForm').scrollIntoView({behavior: 'smooth', block: 'center'});
}

function cancelEditLedger() {
  editingLedgerId = null;
  document.getElementById('lf-amount').value = '';
  document.getElementById('lf-note').value = '';
  document.getElementById('lf-date').value = new Date().toISOString().slice(0,10);
  
  const submitBtn = document.getElementById('lf-submit');
  submitBtn.textContent = '+ Tambah';
  submitBtn.style.backgroundColor = '';
  
  const cancelBtn = document.getElementById('lf-cancel-btn');
  if(cancelBtn) cancelBtn.style.display = 'none';
}

function deleteLedgerEntry(id){
  if(!confirm('Yakin ingin menghapus transaksi ini?')) return;
  state.ledger = state.ledger.filter(t=>t.id!==id);
  queueSave();
  renderAll();
}

function initLedgerFilters(){
  const fm = document.getElementById('filt-month');
  const fy = document.getElementById('filt-year');
  fm.innerHTML = '<option value="all">Semua Bulan</option>' + MONTHS.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
  fm.value = Number(state.period.slice(5,7))-1;
  fy.value = state.period.slice(0,4);
  [fm,fy,document.getElementById('filt-group'),document.getElementById('filt-akun')].forEach(el=>el.onchange = renderLedger);
}

function renderLedger(){
  const bal = accountBalances();
  document.getElementById('acct-bank').textContent = rp(bal.bank);
  document.getElementById('acct-cash').textContent = rp(bal.cash);
  document.getElementById('acct-total').textContent = rp(bal.total);

  const fm = document.getElementById('filt-month').value;
  const fyEl = document.getElementById('filt-year');
  if(!fyEl.value){
    const years = [...new Set(state.ledger.map(t=>t.date.slice(0,4)))].sort();
    fyEl.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join('') || `<option value="${new Date().getFullYear()}">${new Date().getFullYear()}</option>`;
  } else {
    const years = new Set([...state.ledger.map(t=>t.date.slice(0,4)), fyEl.value]);
    const cur = fyEl.value;
    fyEl.innerHTML = [...years].sort().map(y=>`<option value="${y}" ${y===cur?'selected':''}>${y}</option>`).join('');
  }
  const fy = document.getElementById('filt-year').value;
  const fg = document.getElementById('filt-group').value;
  const fa = document.getElementById('filt-akun').value;

  let rows = [...state.ledger].sort((a,b)=> b.date.localeCompare(a.date));
  rows = rows.filter(t=>{
    if(fm!=='all' && Number(t.date.slice(5,7))-1 !== Number(fm)) return false;
    if(fy && t.date.slice(0,4) !== fy) return false;
    if(fg!=='all' && t.group!==fg) return false;
    if(fa!=='all'){
      if(t.group==='mutasi') return false;
      if(t.akun!==fa) return false;
    }
    return true;
  });

  document.getElementById('ledger-empty').style.display = rows.length? 'none':'block';
  document.getElementById('tbl-ledger').innerHTML = rows.map(t=>{
    const catLabel = t.group==='mutasi' ? (t.arah==='bank-cash'?'Rekening → Cash':'Cash → Rekening') : catName(t.categoryId);
    const akunLabel = t.group==='mutasi' ? '—' : (t.akun==='bank'?'Rekening/Bank':'Cash');
    const sign = t.group==='income' ? '+' : (t.group==='mutasi'?'':'-');
    
    return `<tr>
      <td>${new Date(t.date).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</td>
      <td><span class="tag ${t.group}">${GROUP_LABEL[t.group]}</span></td>
      <td>${esc(catLabel)}</td>
      <td>${esc(t.note||'-')}</td>
      <td>${akunLabel}</td>
      <td class="num">${sign}${rp(t.amount)}</td>
      <td style="white-space:nowrap;">
        <button class="iconbtn" onclick="editLedgerEntry('${t.id}')" title="Edit Data">✏️</button>
        <button class="iconbtn" onclick="deleteLedgerEntry('${t.id}')" title="Hapus Data">✕</button>
      </td>
    </tr>`;
  }).join('');
}

/* ============================= AI RECEIPT SCANNER (GROQ VISION AI API) ============================= */
let scanItems = [];

function initScanPanel(){
  refreshApiKeyUI();
  document.getElementById('apikey-save').onclick = ()=>{
    const val = document.getElementById('apikey-input').value.trim();
    if(!val){ alert('Masukkan Groq API key terlebih dahulu.'); return; }
    state.groqApiKey = val;
    queueSave();
    refreshApiKeyUI();
  };
  document.getElementById('apikey-change').onclick = ()=>{
    state.groqApiKey = '';
    queueSave();
    refreshApiKeyUI();
  };

  const drop = document.getElementById('scanDrop');
  const fileInput = document.getElementById('scanFileInput');
  drop.onclick = ()=>{
    if(!state.groqApiKey){ alert('Isi dan simpan Groq API key terlebih dahulu di atas.'); return; }
    fileInput.click();
  };
  drop.ondragover = e=>{ e.preventDefault(); drop.classList.add('dragover'); };
  drop.ondragleave = ()=> drop.classList.remove('dragover');
  drop.ondrop = e=>{
    e.preventDefault(); drop.classList.remove('dragover');
    if(!state.groqApiKey){ alert('Isi dan simpan Groq API key terlebih dahulu di atas.'); return; }
    if(e.dataTransfer.files[0]) handleReceiptFile(e.dataTransfer.files[0]);
  };
  fileInput.onchange = ()=>{ if(fileInput.files[0]) handleReceiptFile(fileInput.files[0]); };
  document.getElementById('scan-add-item').onclick = ()=>{
    scanItems.push({id:uid(), name:'', categoryId:'', qty:1, price:0});
    renderScanItems();
  };
  document.getElementById('scan-cancel').onclick = resetScanPanel;
  document.getElementById('scan-save').onclick = saveScanToLedger;
  document.getElementById('scan-group').onchange = ()=>{
    scanItems.forEach(it=> it.categoryId = '');
    renderScanItems();
  };
}

function refreshApiKeyUI(){
  const has = !!(state.groqApiKey && state.groqApiKey.trim());
  document.getElementById('apikeyRow').style.display = has ? 'none' : 'block';
  document.getElementById('apikeySavedNote').style.display = has ? 'block' : 'none';
}

function resetScanPanel(){
  scanItems = [];
  document.getElementById('scanResult').style.display='none';
  document.getElementById('scanPreviewImg').style.display='none';
  document.getElementById('scanError').style.display='none';
  document.getElementById('scanLoading').style.display='none';
  document.getElementById('scanFileInput').value='';
}

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(r.result.split(',')[1]);
    r.onerror = ()=> reject(new Error('Gagal membaca file foto'));
    r.readAsDataURL(file);
  });
}

function convertImageToPng(file){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=>{
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img,0,0);
      resolve({base64: canvas.toDataURL('image/png').split(',')[1]});
    };
    img.onerror = ()=> reject(new Error('Format foto tidak didukung browser ini. Gunakan file JPG/PNG.'));
    img.src = URL.createObjectURL(file);
  });
}

async function handleReceiptFile(file){
  if(!state.groqApiKey){ alert('Isi dan simpan Groq API key terlebih dahulu di atas.'); return; }
  const preview = document.getElementById('scanPreviewImg');
  document.getElementById('scanResult').style.display='none';
  document.getElementById('scanError').style.display='none';
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
  
  const loadingEl = document.getElementById('scanLoading');
  loadingEl.style.display = 'flex';
  loadingEl.innerHTML = '<div class="spinner"></div> Menganalisis foto dengan Groq Vision AI...';

  try{
    let base64 = await fileToBase64(file);
    let mediaType = file.type || 'image/jpeg';
    if(!['image/jpeg','image/png','image/gif','image/webp'].includes(mediaType)){
      const converted = await convertImageToPng(file);
      base64 = converted.base64; mediaType = 'image/png';
    }

    const dataUrl = `data:${mediaType};base64,${base64}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.groqApiKey.trim()}`
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct", 
        temperature: 0.1,
        max_tokens: 2000, 
        messages: [{
          role: "user",
          content: [
            { 
              type: "text", 
              text: "Ini adalah gambar foto struk belanja / bukti transfer bank / slip gaji. Analisis dan ekstrak isinya secara akurat. Balas HANYA dengan JSON valid murni tanpa penjelasan lain, tanpa markdown backticks, dengan struktur persis: {\"merchant\":\"nama toko atau nama bank/pengirim\",\"date\":\"YYYY-MM-DD atau kosong jika tidak terbaca\",\"items\":[{\"name\":\"nama barang atau jenis transaksi\",\"qty\":1,\"price\":harga satuan angka murni}],\"total\":total nominal transaksi angka murni}. PENTING: Jangan masukkan nomor rekening, ID referensi, atau tanggal sebagai harga nominal!" 
            },
            { 
              type: "image_url", 
              image_url: { url: dataUrl } 
            }
          ]
        }]
      })
    });

    if(!response.ok){
      let detail = '';
      try{ const errBody = await response.json(); detail = errBody?.error?.message || ''; }catch(e){}
      if(response.status===401) throw new Error('Groq API Key tidak valid. Periksa kembali di console.groq.com');
      if(response.status===429) throw new Error('Batas limit Groq API tercapai, coba lagi sebentar.');
      throw new Error('Gagal menghubungi Groq AI (status '+response.status+'). ' + detail);
    }

    const resData = await response.json();
    const rawContent = resData?.choices?.[0]?.message?.content || '';
    if(!rawContent) throw new Error('AI Groq tidak mengembalikan respon teks.');

    const firstBrace = rawContent.indexOf('{');
    const lastBrace = rawContent.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      const cleanJson = rawContent.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(cleanJson);
      populateScanResult(parsed);
    } else {
      throw new Error('AI terpotong atau tidak memberikan data format tabel JSON. Silakan coba unggah lagi.');
    }
  }catch(err){
    console.error(err);
    document.getElementById('scanError').style.display = 'block';
    let msg = err.message || 'Gagal membaca struk dengan AI.';
    if(msg === 'Failed to fetch'){ msg = 'Tidak dapat terhubung ke Groq API. Periksa koneksi internet atau API key Anda.'; }
    document.getElementById('scanError').textContent = '⚠️ ' + msg + ' Kamu tetap bisa isi transaksi manual di bawah.';
  }finally{
    loadingEl.style.display = 'none';
  }
}

function populateScanResult(parsed){
  document.getElementById('scan-merchant').value = parsed.merchant || '';
  document.getElementById('scan-date').value = (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) ? parsed.date : new Date().toISOString().slice(0,10);
  scanItems = (parsed.items||[]).map(it=>({
    id:uid(), name: it.name || 'Item', categoryId:'', qty: Number(it.qty)||1, price: Number(it.price)||0
  }));
  if(!scanItems.length) scanItems.push({id:uid(), name:'', categoryId:'', qty:1, price: Number(parsed.total)||0});
  renderScanItems();
  document.getElementById('scanResult').style.display = 'block';
}

function renderScanItems(){
  const group = document.getElementById('scan-group').value;
  const cats = catsByGroup(group);
  let total = 0;
  document.getElementById('scan-items-body').innerHTML = scanItems.map(it=>{
    const subtotal = (Number(it.qty)||0) * (Number(it.price)||0);
    total += subtotal;
    if(!it.categoryId && cats.length) it.categoryId = cats[0].id;
    return `<tr>
      <td>🧾</td>
      <td><input type="text" value="${esc(it.name)}" onchange="updateScanItem('${it.id}','name',this.value)"></td>
      <td><select onchange="updateScanItem('${it.id}','categoryId',this.value)">
        ${cats.length? cats.map(c=>`<option value="${c.id}" ${c.id===it.categoryId?'selected':''}>${esc(c.name)}</option>`).join('') : '<option value="">(belum ada kategori)</option>'}
      </select></td>
      <td><input type="number" value="${it.qty}" min="0" onchange="updateScanItem('${it.id}','qty',Number(this.value))"></td>
      <td><input type="number" value="${it.price}" min="0" onchange="updateScanItem('${it.id}','price',Number(this.value))"></td>
      <td class="num">${rp(subtotal)}</td>
      <td><button class="iconbtn" onclick="removeScanItem('${it.id}')">✕</button></td>
    </tr>`;
  }).join('');
  document.getElementById('scan-total-display').textContent = rp(total);
}

function updateScanItem(id, field, val){
  const it = scanItems.find(i=>i.id===id);
  if(it){ it[field]=val; renderScanItems(); }
}

function removeScanItem(id){
  scanItems = scanItems.filter(i=>i.id!==id);
  renderScanItems();
}

function saveScanToLedger(){
  if(!scanItems.length){ alert('Belum ada item untuk disimpan.'); return; }
  const group = document.getElementById('scan-group').value;
  const akun = document.getElementById('scan-akun').value;
  const date = document.getElementById('scan-date').value || new Date().toISOString().slice(0,10);
  const merchant = document.getElementById('scan-merchant').value.trim();
  const missingCat = scanItems.some(it=>!it.categoryId);
  if(missingCat){ alert('Ada item tanpa kategori. Tambahkan kategori dulu di tab Budgeting, atau pilih kategori untuk tiap item.'); return; }
  scanItems.forEach(it=>{
    const amount = (Number(it.qty)||0) * (Number(it.price)||0);
    if(amount===0) return;
    state.ledger.push({
      id: uid(), date, group, categoryId: it.categoryId, akun,
      amount: Math.abs(amount),
      note: (merchant ? merchant+' — ' : '') + (it.name || 'Item struk')
    });
  });
  queueSave();
  resetScanPanel();
  initPeriodPickers();
  renderAll();
}

/* ============================= RENDER: SAVINGS ============================= */
function renderSavings(){
  const cats = catsByGroup('saving');
  const grid = document.getElementById('goal-grid');
  if(!cats.length){ grid.innerHTML = '<div class="empty-note">Belum ada target tabungan. Tambahkan lewat tab Budgeting Bulanan.</div>'; return; }
  
  grid.innerHTML = cats.map(c=>{
    const saved = lifetimeSavedForCategory(c.id);
    const target = Number(c.target||0);
    const pct = target>0 ? Math.min(100, Math.round(saved/target*100)) : 0;
    
    return `<div class="goal-card">
      <h4>${esc(c.name)}</h4>
      <span class="badge Optional">${c.jenis || 'Tunai/Bank'}</span>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
      <div class="goal-stats"><span>${rp(saved)} terkumpul</span><span>${target? pct+'% dari '+rp(target) : 'Target belum diatur'}</span></div>
      
      <hr style="border:none; border-top:1px dashed var(--line); margin:14px 0 10px;">
      <div style="font-size:10.5px; font-weight:700; color:var(--forest); margin-bottom:6px;">➕ Isi Tabungan Cepat</div>
      <div style="display:flex; gap:6px;">
        <input type="number" id="qs-amt-${c.id}" placeholder="Nominal Rp" style="flex:1; padding:6px; font-size:11.5px;">
        <select id="qs-akun-${c.id}" style="width:75px; padding:6px 2px; font-size:11.5px;">
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
        </select>
        <button class="btn btn-primary" style="padding:6px 12px; font-size:11.5px;" onclick="quickAddSaving('${c.id}')">Simpan</button>
      </div>
    </div>`;
  }).join('');
}

// FUNGSI NABUNG CEPAT DARI TAB TABUNGAN
function quickAddSaving(catId) {
  const amtInput = document.getElementById(`qs-amt-${catId}`);
  const akunInput = document.getElementById(`qs-akun-${catId}`);
  const amount = Number(amtInput.value);
  const akun = akunInput.value;
  
  if(!amount || amount <= 0) {
    alert("⚠️ Masukkan nominal tabungan yang valid!");
    return;
  }

  const date = new Date().toISOString().slice(0,10);
  const name = catName(catId);
  
  state.ledger.push({
    id: uid(),
    date: date,
    group: 'saving',
    categoryId: catId,
    akun: akun,
    amount: amount,
    note: `Nabung Cepat: ${name}` 
  });
  
  queueSave(); 
  initPeriodPickers(); 
  renderAll(); 
  
  alert(`✅ Berhasil menabung ${rp(amount)} untuk target ${name}!`);
}

/* ============================= RENDER: BUDGETING ============================= */
function renderBudgeting(){
  const p = state.period;
  const groups = [
    ['saving','Tabungan / Saving', true],
    ['fixed','Pengeluaran Tetap / Fixed Cost', false],
    ['variable','Pengeluaran Tidak Tetap / Variable Cost', false],
    ['subscription','Langganan & Hutang / Subscription & Debt', false]
  ];
  const wrap = document.getElementById('budget-groups');
  
  wrap.innerHTML = groups.map(([g,label,hasTarget])=>{
    const cats = catsByGroup(g);
    const rows = cats.map(c=>`
      <tr>
        <td>${esc(c.name)} <button class="iconbtn" onclick="deleteCategory('${c.id}')" title="Hapus kategori">✕</button></td>
        <td>
          ${g === 'saving' 
            ? `<select onchange="updateJenisSaving('${c.id}', this.value)">
                ${['Tunai/Bank','Emas','Reksadana','Saham','Deposito','Lainnya'].map(j=>`<option ${c.jenis===j || (!c.jenis && j==='Tunai/Bank') ?'selected':''}>${j}</option>`).join('')}
               </select>`
            : `<select onchange="updatePriority('${c.id}', this.value)">
                ${['High','Medium','Optional'].map(pr=>`<option ${c.prioritas===pr?'selected':''}>${pr}</option>`).join('')}
               </select>`
          }
        </td>
        <td><input type="number" value="${budgetFor(p,c.id)||''}" placeholder="0" onchange="setBudget('${p}','${c.id}', Number(this.value)); renderAll();"></td>
        ${hasTarget ? `<td><input type="number" value="${c.target||''}" placeholder="target total" onchange="updateTarget('${c.id}', Number(this.value))"></td>` : ''}
      </tr>`).join('');
      
    return `<div class="budget-group panel">
      <div class="budget-group-head"><h3 style="margin:0;">${label}</h3></div>
      <table>
        <thead><tr><th>Keterangan</th><th>${g === 'saving' ? 'Jenis' : 'Prioritas'}</th><th>Rencana (${MONTHS[Number(p.slice(5,7))-1]} ${p.slice(0,4)})</th>${hasTarget?'<th>Target Total</th>':''}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${hasTarget?4:3}" style="text-align:center;color:#9ab293;">Belum ada kategori</td></tr>`}</tbody>
      </table>
      <div class="add-cat-row">
        <input type="text" id="new-${g}-name" placeholder="Tambah kategori baru">
        ${g === 'saving' 
          ? `<select id="new-${g}-jenis"><option value="Tunai/Bank">Tunai/Bank</option><option value="Emas">Emas</option><option value="Reksadana">Reksadana</option><option value="Saham">Saham</option><option value="Deposito">Deposito</option><option value="Lainnya">Lainnya</option></select>`
          : `<select id="new-${g}-prio"><option>Medium</option><option>High</option><option>Optional</option></select>`
        }
        <button class="btn btn-primary btn-sm" onclick="addCategory('${g}')">+ Tambah</button>
      </div>
    </div>`;
  }).join('');

  document.getElementById('budget-income-cats').innerHTML = catsByGroup('income').map(c=>`
    <tr><td>${esc(c.name)}</td><td><span class="badge ${c.tipe}">${c.tipe}</span></td>
    <td><button class="iconbtn" onclick="deleteCategory('${c.id}')">✕</button></td></tr>`).join('')
    || '<tr><td colspan="3" style="text-align:center;color:#9ab293;">Belum ada sumber</td></tr>';
}

function addCategory(g){
  const nameEl = document.getElementById(`new-${g}-name`);
  const name = nameEl.value.trim();
  if(!name) return;
  
  const cat = {id:uid(), group:g, name: name};

  if(g === 'saving') {
    const jenisEl = document.getElementById(`new-${g}-jenis`);
    cat.jenis = jenisEl.value;
    cat.target = 0; 
  } else {
    const prioEl = document.getElementById(`new-${g}-prio`);
    cat.prioritas = prioEl.value;
  }
  
  state.categories.push(cat);
  queueSave(); 
  renderAll();
}

function updateJenisSaving(id, val){
  const c = state.categories.find(c=>c.id===id); 
  if(c){ c.jenis = val; queueSave(); renderAll(); }
}

document.getElementById('add-income-cat').onclick = ()=>{
  const name = document.getElementById('new-income-name').value.trim();
  const tipe = document.getElementById('new-income-tipe').value;
  if(!name) return;
  state.categories.push({id:uid(), group:'income', name, tipe});
  document.getElementById('new-income-name').value='';
  queueSave(); renderAll();
};
function deleteCategory(id){
  if(!confirm('Hapus kategori ini? Transaksi lama pada kategori ini akan tetap tersimpan.')) return;
  state.categories = state.categories.filter(c=>c.id!==id);
  queueSave(); renderAll();
}
function updatePriority(id, val){
  const c = state.categories.find(c=>c.id===id); if(c){ c.prioritas = val; queueSave(); }
}
function updateTarget(id, val){
  const c = state.categories.find(c=>c.id===id); if(c){ c.target = val; queueSave(); renderAll(); }
}
document.getElementById('btn-copy-prev').onclick = ()=>{
  const [y,m] = state.period.split('-').map(Number);
  const prevDate = new Date(y, m-2, 1);
  const prevPeriod = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
  if(!state.budgets[prevPeriod]){ alert('Tidak ada data rencana di bulan sebelumnya.'); return; }
  state.budgets[state.period] = {...state.budgets[prevPeriod]};
  queueSave(); renderAll();
  alert('Rencana bulan sebelumnya berhasil disalin.');
};

/* ============================= MAIN RENDER ============================= */
function renderAll(){
  const active = document.querySelector('.tab-btn.active').dataset.tab;
  if(active==='dashboard'){
    const dashView = document.querySelector('.toggle-btn.active').dataset.dashview;
    if(dashView==='yearly') renderYearlyDashboard(); else renderDashboard();
  }
  if(active==='ledger'){ updateLedgerFormFields(); renderLedger(); }
  if(active==='savings') renderSavings();
  if(active==='budgeting') renderBudgeting();
}

/* ============================= INIT ============================= */
(async function initAuthGate(){
  const auth = await loadFamilyAuth();
  showAuthForm(auth ? 'auth-login' : 'auth-setup');
  await refreshSetupTab();
  
  // Tampilkan layar loading awal saat pertama kali dibuka
  setTimeout(() => {
    const loader = document.getElementById('globalLoading');
    if(loader) {
      loader.style.opacity = '0';
      setTimeout(() => {
        loader.style.display = 'none';
        document.getElementById('authScreen').style.display = 'flex';
      }, 400);
    } else {
      document.getElementById('authScreen').style.display = 'flex';
    }
  }, 1200); 
})();