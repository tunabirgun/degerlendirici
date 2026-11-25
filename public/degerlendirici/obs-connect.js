// OBS'den belge alma. Yalnızca obs-koprusu/sunucu.py ile açılan yerel uygulamada görünür.
const obsDocuments=[
 {report:'ders_yoklama',section:2,title:'Ders Yoklama Listesi',help:'Devam çizelgesi ve öğrenci listesi',checked:true},
 {report:'sinav_not',section:3,title:'Sınav Not Listesi',help:'Dönem sonu harf notları',checked:true},
 {report:'sinif_basari',section:3,title:'Sınıf Başarı İstatistikleri',help:'Harf Notları ve İstatistikler bölümüne eklenir'},
 {report:'not_basari',section:3,title:'Not Başarı İstatistikleri',help:'Harf Notları ve İstatistikler bölümüne eklenir'},
 {report:'egitim_rehberi',section:1,title:'Eğitim Rehberi',help:'Ders İzlencesi bölümüne eklenir'}
];
class ObsError extends Error{
 constructor({hata,oneri='',kod='',giris=false}){super(hata||'OBS işlemi tamamlanamadı.');this.hint=oneri;this.code=kod;this.login=giris}
}
const obsBridgeErrors={
 closed:{kod:'kopru',hata:'Yerel sunucuya ulaşılamadı.',oneri:'Köprüyü yeniden açın ve açılan yerel sekmeden devam edin.'},
 key:{kod:'anahtar',hata:'Bu sayfanın OBS bağlantı izni yok.',oneri:'Köprüyü tekrar açıp yönlendirildiğiniz sekmeyi kullanın.'}
};

async function obsRequest(path,body,signal){
 let response;
 try{
  response=await fetch('/api/obs/'+path,{
   method:body?'POST':'GET',cache:'no-store',signal,
   headers:{'X-OBS-Koprusu':'1',...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined
  });
 }catch(error){
  if(error.name==='AbortError')throw error;
  throw new ObsError(obsBridgeErrors.closed);
 }
 if(response.ok)return response;
 const data=await response.json().catch(()=>({}));
 throw new ObsError(data.kod==='anahtar'?obsBridgeErrors.key:data.hata?data:obsBridgeErrors.closed);
}
const obsJson=async(path,body,signal)=>(await obsRequest(path,body,signal)).json();
const obsButton=(id,label,name)=>btn(label,'',name).replace('<button onclick=""','<button type="button" id="'+id+'"');
const obsTime=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');

// Closing the dialog, or opening another one, cancels everything started from it.
function obsDialog(title,body){
 dialog(title,body+'<span id="obsStep" hidden></span>');
 const step=$('obsStep'),control=new AbortController();
 const active=()=>modal.open&&step.isConnected;
 const watch=setInterval(()=>{if(!active()){clearInterval(watch);control.abort()}},250);
 return {active,signal:control.signal};
}
// files: documents that arrived but could not be saved in the browser
function obsFailed(error,view,retry,files=[]){
 if(!view.active()||error.name==='AbortError')return;
 if(error.login){obsConnect(error.message,retry);return}
 const code=error.code||'arayuz';
 if(!(error instanceof ObsError))console.error('OBS aktarım hatası',error);
 dialog('OBS işlemi tamamlanamadı','<p role="alert"><strong>'+esc(error.message)+'</strong></p>'+(error.hint?'<p>'+esc(error.hint)+'</p>':'')+
  (files.length?'<p>Belgeler OBS’den alındı ama derse kaydedilemedi. Kaybolmamaları için bilgisayarınıza indirebilirsiniz.</p>':'')+
  '<div class="actions">'+(files.length?obsButton('obsSaveFiles','Belgeleri indir','download'):'')+
  (['kopru','anahtar'].includes(code)?'':obsButton('obsRetry','Yeniden dene','refresh-cw'))+
  obsButton('obsHelp','Tanı bilgisi','clipboard-list')+btn('Kapat','modal.close()')+'</div>');
 if($('obsRetry'))$('obsRetry').onclick=retry;
 if(files.length)$('obsSaveFiles').onclick=()=>files.forEach((file,i)=>setTimeout(()=>download(file,file.name),i*400));
 $('obsHelp').onclick=()=>obsDiagnostics(code);
}
// The text holds versions, step names and error codes. No student, course or account information.
async function obsDiagnostics(code=''){
 const info={hata:code,tarayici:(navigator.userAgent.match(/(Firefox|Edg|Chrome|Version)\/[\d.]+/)||[''])[0]};
 try{Object.assign(info,{kopru:await obsJson('tani')})}catch(error){info.kopru=error.code||'ulaşılamadı'}
 const view=obsDialog('Tanı bilgisi','<p>Sorunu bildirirken bu metni ekleyebilirsiniz. Öğrenci, ders veya hesap bilgisi içermez.</p><textarea id="obsInfo" rows="12" readonly aria-label="Tanı bilgisi">'+esc(JSON.stringify(info,null,1))+'</textarea><p id="obsStatus" role="status"></p><div class="actions">'+obsButton('obsCopy','Kopyala','files')+btn('Kapat','modal.close()')+'</div>');
 $('obsCopy').onclick=async()=>{
  try{await navigator.clipboard.writeText($('obsInfo').value)}catch{$('obsInfo').select();document.execCommand('copy')}
  if(view.active())$('obsStatus').textContent='Kopyalandı.';
 };
}

// resume: continues an interrupted download after the user has logged in again
async function obsConnect(reason='',resume=null){
 const retry=()=>obsConnect('',resume);
 const view=obsDialog('OBS’ye bağlan',(reason?'<p role="alert"><strong>'+esc(reason)+'</strong></p>':'')+
  '<p>Açılan OBS penceresinde kullanıcı adınızı, şifrenizi ve güvenlik kodunu girin. Bu bilgiler Değerlendirici’ye aktarılmaz.'+(resume?' Giriş yaptığınızda kaldığı yerden devam edilir.':'')+'</p><p id="obsStatus" role="status">OBS penceresi açılıyor…</p><p class="sub" id="obsTimeLeft"></p>'+
  '<div class="actions">'+obsButton('obsFront','OBS penceresini öne getir','monitor')+obsButton('obsCancel','Vazgeç','x')+'</div>');
 const status=$('obsStatus');
 $('obsFront').onclick=()=>obsJson('one-getir',{}).catch(()=>{});
 $('obsCancel').onclick=()=>{modal.close();obsJson('kapat',{}).catch(()=>{})};
 const say=text=>{if(status.textContent!==text)status.textContent=text};
 try{
  let state=await obsJson('baglan',{},view.signal);
  while(view.active()&&state.durum==='bekliyor'){
   say(state.mesaj?'OBS: '+state.mesaj:state.ek_islem?'OBS penceresinde tamamlanması gereken bir adım var (ör. şifre yenileme veya onay).':'Giriş yapmanız bekleniyor…');
   $('obsTimeLeft').textContent='Kalan süre '+obsTime(state.kalan);
   await new Promise(resolve=>setTimeout(resolve,1000));
   if(view.active())state=await obsJson('durum',null,view.signal);
  }
  if(!view.active())return;
  if(state.durum!=='bagli')throw new ObsError({...state,giris:false});
  obsConnected(true);
  $('obsTimeLeft').textContent='';$('obsFront').hidden=$('obsCancel').hidden=true;
  if(resume){resume();return}
  say('Giriş yapıldı. Dönemler alınıyor…');
  const terms=await obsJson('donemler',{},view.signal);
  if(view.active())obsChoose(terms);
 }catch(error){
  if(error.login)error.login=false;
  obsFailed(error,view,retry);
 }
}
async function obsLeave(){await obsJson('kapat',{});obsConnected(false)}
let obsAvailable=false;
function obsConnected(on){
 for(const label of document.querySelectorAll('.obs-connect span'))label.textContent=on?'OBS’den belge al':'OBS’ye bağlan';
}
// The last choice is kept in this browser. It holds the term and document types only.
function obsRemembered(){try{return JSON.parse(localStorage.obsChoice)||{}}catch{return {}}}
function obsRemember(term,docs){try{localStorage.obsChoice=JSON.stringify({term,docs:docs.map(d=>d.report)})}catch{/* Storage may be disabled. */}}

function obsYear(term){return parseTerm(term).year||term}
function obsChoose(terms){
 if(!terms.length){obsFailed(new ObsError({hata:'OBS’de dönem bulunamadı.',oneri:'Bu hesabın akademik panelde dersi olduğunu kontrol edin.'}),{active:()=>true},()=>obsConnect());return}
 const years=[...new Set(terms.map(t=>obsYear(t.ad)))];
 const last=obsRemembered();
 // The running term is rarely complete, so a finished one is offered first.
 const start=terms.find(t=>t.ad===last.term)||terms.find(t=>!t.aktif)||terms[0];
 const view=obsDialog('OBS’den belge al','<form id="obsForm"><div class="fieldpair"><label>Akademik yıl<select id="obsYear">'+
  years.map(y=>'<option '+(y===obsYear(start.ad)?'selected':'')+'>'+esc(y)+'</option>').join('')+'</select></label><label>Dönem<select id="obsTerm"></select></label></div>'+
  '<p id="obsTermNote" hidden>Bu dönem sürüyor. OBS belgeleri henüz tamamlanmamış olabilir.</p>'+
  '<label>Ders<select id="obsCourse" disabled></select></label><label>Kaydedilecek ders<select id="obsTarget"></select></label>'+
  '<fieldset class="obs-documents"><legend>Aktarılacak belgeler</legend>'+obsDocuments.map((d,i)=>'<label><input type="checkbox" name="doc" value="'+i+'" '+((last.docs?last.docs.includes(d.report):d.checked)?'checked':'')+'><span>'+esc(d.title)+' <span class="sub">'+esc(d.help)+'</span></span></label>').join('')+'</fieldset>'+
  '<p id="obsReplace" hidden>Bu derse daha önce OBS’den alınan aynı belgeler yenisiyle değiştirilir.</p><p id="obsStatus" role="status"></p>'+
  '<div class="actions"><button class="primary" id="obsFetch" disabled>'+icon('download')+'Belgeleri al</button>'+obsButton('obsSwitch','Farklı hesapla gir','user-round')+obsButton('obsLeave','Bağlantıyı kapat','x')+'</div></form>');
 const yearBox=$('obsYear'),termBox=$('obsTerm'),courseBox=$('obsCourse'),targetBox=$('obsTarget'),status=$('obsStatus');
 let found=[],loading=0;
 function showTerms(){
  termBox.innerHTML=terms.filter(t=>obsYear(t.ad)===yearBox.value).map(t=>'<option value="'+esc(t.ad)+'" '+(t===start?'selected':'')+'>'+esc(parseTerm(t.ad).season||t.ad)+'</option>').join('');
  loadCourses();
 }
 async function loadCourses(){
  const request=++loading,term=termBox.value;
  $('obsTermNote').hidden=!terms.find(t=>t.ad===term)?.aktif;
  courseBox.disabled=$('obsFetch').disabled=true;
  courseBox.innerHTML=targetBox.innerHTML='';
  status.textContent='Dersler alınıyor…';
  try{
   const list=await obsJson('dersler',{donem:term},view.signal);
   if(request!==loading||!view.active())return;
   found=list;
   courseBox.innerHTML=found.map((c,i)=>'<option value="'+i+'">'+esc(c.kod+' · '+c.ad+' · Şube '+c.sube+(found.some(o=>o!==c&&o.kod===c.kod&&o.sube===c.sube)?' · '+c.program:''))+'</option>').join('');
   courseBox.disabled=$('obsFetch').disabled=!found.length;
   status.textContent=found.length?found.length+' ders bulundu.':'Bu dönemde ders bulunamadı. Başka bir dönem seçin.';
   if(found.length)showTargets();
  }catch(error){if(request===loading)obsFailed(error,view,()=>obsConnect())}
 }
 function showTargets(){
  const c=found[courseBox.value],match=obsMatch(c,termBox.value);
  targetBox.innerHTML='<option value="">Yeni ders — '+esc(c.kod+' · '+c.ad)+'</option>'+courseList.filter(r=>norm(r.code)===norm(c.kod)).map(r=>'<option value="'+esc(r.id)+'" '+(r===match?'selected':'')+'>'+esc(r.code+' · '+r.name+(r.term?' · '+r.term:'')+(r.obs?' · Şube '+r.obs.sube:''))+'</option>').join('');
  showReplace();
 }
 const showReplace=()=>{$('obsReplace').hidden=!courseList.find(r=>r.id===targetBox.value)?.obs};
 targetBox.onchange=showReplace;
 yearBox.onchange=showTerms;termBox.onchange=loadCourses;courseBox.onchange=showTargets;
 // The OBS session stays open while the local server runs, so the next user must be able to leave it.
 $('obsSwitch').onclick=async()=>{$('obsSwitch').disabled=true;try{await obsLeave();if(view.active())obsConnect()}catch(e){obsFailed(e,view,()=>obsChoose(terms))}};
 $('obsLeave').onclick=async()=>{try{await obsLeave();if(view.active()){modal.close();notify('OBS bağlantısı kapatıldı.')}}catch(e){obsFailed(e,view,()=>obsChoose(terms))}};
 $('obsForm').onsubmit=event=>{
  event.preventDefault();
  if($('obsFetch').disabled)return;
  const docs=[...document.querySelectorAll('#obsForm [name=doc]:checked')].map(box=>obsDocuments[box.value]);
  if(!docs.length){status.textContent='En az bir belge seçin.';return}
  obsRemember(termBox.value,docs);
  obsFetch(found[courseBox.value],termBox.value,targetBox.value,docs);
 };
 showTerms();
}
// A course taken from OBS before is matched by term, section and program. Courses entered by hand have no section.
function obsMatch(source,term){
 const {year,season}=parseTerm(term);
 const same=courseList.filter(r=>{
  const t={...parseTerm(r.term),...r};
  return norm(r.code)===norm(source.kod)&&t.year===year&&t.season===season;
 });
 return same.find(r=>r.obs?.sube===source.sube&&r.obs?.program===source.program)||same.find(r=>!r.obs);
}

// earlier: what previous attempts of the same request have already saved
async function obsFetch(source,term,targetId,docs,earlier={received:[],empty:[]}){
 const view=obsDialog('OBS’den belge al','<p>'+esc(source.kod+' · '+source.ad+' · Şube '+source.sube+' · '+term)+'</p><ul class="package-checklist" id="obsProgress">'+docs.map(d=>'<li>'+esc(d.title)+': <span>bekliyor</span></li>').join('')+'</ul><p id="obsStatus" role="status"></p><div class="actions">'+obsButton('obsStop','Durdur','x')+'</div>');
 const labels=[...document.querySelectorAll('#obsProgress span')],status=$('obsStatus');
 const received=[],empty=[...earlier.empty],failed=[];
 let interrupted=null,stopped=false,left=[];
 $('obsStop').onclick=()=>{stopped=true;$('obsStop').disabled=true;status.textContent='Sıradaki belge bitince durdurulacak.'};
 for(const [i,doc] of docs.entries()){
  if(stopped||interrupted){left=docs.slice(i);break}
  labels[i].textContent='alınıyor…';
  const slow=setTimeout(()=>{if(view.active()&&!stopped)status.textContent='OBS yavaş yanıt veriyor, bekleniyor…'},15000);
  try{
   const response=await obsRequest('belge',{donem:term,ders:source,rapor:doc.report},view.signal);
   const blob=await response.blob();
   if(response.headers.get('X-OBS-Bos')==='1'){
    empty.push(doc);
    labels[i].textContent='boş';
   }else{
    const name=safePart([source.kod,'Şube '+source.sube,source.program,term.replace(/\s*\(.*\)/,''),doc.title].filter(Boolean).join(' - '))+'.pdf';
    received.push({doc,file:new File([blob],name,{type:'application/pdf'})});
    labels[i].textContent='alındı';
   }
  }catch(error){
   if(!view.active())return;
   if(error.login||['kopru','anahtar','ag'].includes(error.code)){interrupted=error;left=docs.slice(i);break}
   failed.push({doc,error});
   labels[i].textContent='alınamadı';
  }finally{
   clearTimeout(slow);
   if(!stopped)status.textContent='';
  }
 }
 if(!view.active())return;
 // Whatever arrived is saved before any error is shown.
 let saved=null,rosterNote=earlier.rosterNote||'';
 if(received.length){
  $('obsStop').disabled=true;
  try{
   const sourceFile=received.find(r=>r.doc.report==='ders_yoklama')||received.find(r=>r.doc.report==='sinav_not');
   let list;
   if(sourceFile){
    status.textContent='Öğrenci numaraları ve adları okunuyor…';
    try{list=await readRoster(sourceFile.file,true)}catch{/* The original PDF can still be filed. */}
    if(!view.active())return;
   }
   const result=await obsStore(source,term,targetId,received,list);
   saved=result.record;
   if(sourceFile)rosterNote=result.rosterNote;
  }
  catch(error){obsFailed(error,view,()=>obsFetch(source,term,targetId,docs,earlier),received.map(r=>r.file));return}
  course=saved;localStorage.selectedCourse=saved.id;opened=received[0].doc.section;filter=0;
  render();
 }
 if(!view.active())return;
 const result={received:[...earlier.received,...received],empty,rosterNote};
 const again=list=>obsFetch(source,term,saved?.id||targetId,list,result);
 if(interrupted){
  obsConnected(false);
  const kept=result.received.length;
  if(kept)interrupted.message+=' Alınan '+kept+' belge kaydedildi.';
  obsFailed(interrupted,view,()=>again([...failed.map(f=>f.doc),...left]));
  return;
 }
 obsDone(result,failed,left,again);
}

async function obsStore(source,term,targetId,received,list){
 const existing=courseList.find(r=>r.id===targetId);
 if(targetId&&!existing)throw new Error('Seçilen ders bulunamadı. Yeniden deneyin.');
 const record=existing||fresh(source.ad,source.kod);
 const changes={obs:{sube:source.sube,program:source.program},done:[...record.done],files:record.files.map(group=>[...group])};
 if(!existing){
  const {year,season}=parseTerm(term);
  Object.assign(changes,{year,season,title:'',given:'',family:'',term:[year,season].filter(Boolean).join(' ')});
 }
 for(const {doc,file} of received){
  const group=changes.files[doc.section],old=group.findIndex(f=>f.name===file.name);
  if(old<0)group.push(file);
  else{
   if(doc.section===3&&record.obsLetters?.key===obsFileKey(group[old]))changes.obsLetters=undefined;
   group[old]=file;
  }
  changes.done[doc.section]=false;
 }
 let rosterNote='Öğrenci listesi için belgeyi gözden geçirin.';
 if(list?.entries.length&&!list.scanned&&!list.conflicts.length&&(!list.code||norm(list.code)===norm(source.kod))){
  const refs=rosterReferences(record);
  const consistent=list.entries.every(([id,name])=>{
   const ref=refs.get(id);
   return name&&[ref?.name,...(ref?.sheets||[])].every(other=>!other||norm(name)===norm(other));
  });
  if(consistent){
   const roster=new Map(record.roster||[]);
   for(const [id,name] of list.entries)if(!roster.has(id))roster.set(id,name);
   changes.roster=Array.from(roster);
   changes.sheets={...record.sheets};
   for(const [key,sheet] of Object.entries(record.sheets)){
    const updated={...sheet};
    mergeRoster(updated,list.entries);
    if(updated.rows!==sheet.rows){changes.sheets[key]=updated;changes.done[4]=false}
   }
   rosterNote=list.entries.length+' öğrencinin numarası ve adı not tablosu için hazır. Yeni sınavlarda bu liste açılır.';
  }
 }
 const before=Object.fromEntries(Object.keys(changes).map(key=>[key,record[key]]));
 Object.assign(record,changes);
 try{await persist(record)}catch(error){Object.assign(record,before);throw error}
 if(!existing)courseList.push(record);
 return {record,rosterNote};
}

function obsDone({received,empty,rosterNote},failed,left,again){
 const roster=(received.findLast(r=>r.doc.report==='ders_yoklama')||received.findLast(r=>r.doc.report==='sinav_not'))?.file;
 const letters=received.findLast(r=>r.doc.report==='sinav_not')?.file;
 const list=items=>'<ul class="package-checklist">'+items.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul>';
 const remaining=[...failed.map(f=>f.doc),...left];
 const hints=[...new Set(failed.map(f=>f.error.hint).filter(Boolean))];
 dialog(remaining.length?'Bazı belgeler alınamadı':'OBS’den alınan belgeler',
  (received.length?list(received.map(({doc})=>doc.title+' → '+sections[doc.section][0])):'<p>Eklenen belge yok.</p>')+
  (empty.length?'<h3>OBS’de boş olanlar</h3>'+list(empty.map(d=>d.title))+'<p>Bu şubede kayıtlı öğrenci ya da girilmiş veri görünmüyor, bu yüzden eklenmedi. Ders birden çok şube veya programda açıldıysa diğerini deneyin.</p>':'')+
  (failed.length?'<h3>Alınamayanlar</h3>'+list(failed.map(f=>f.doc.title+': '+f.error.message))+hints.map(h=>'<p>'+esc(h)+'</p>').join(''):'')+
  (left.length?'<h3>Durdurulduğu için alınmayanlar</h3>'+list(left.map(d=>d.title)):'')+
  (rosterNote?'<p role="status">'+esc(rosterNote)+'</p>':'')+
  '<div class="actions">'+(remaining.length?obsButton('obsAgain','Kalanları yeniden dene','refresh-cw'):'')+
  (roster?obsButton('obsRoster','Öğrenci listesini incele','users'):'')+(letters?obsButton('obsLetters','Harf notlarını oku','scan-text'):'')+
  obsButton('obsOther','Başka ders','plug')+(failed.length?obsButton('obsHelp','Tanı bilgisi','clipboard-list'):'')+btn('Kapat','modal.close()')+'</div>');
 if(remaining.length)$('obsAgain').onclick=()=>again(remaining);
 if(roster)$('obsRoster').onclick=()=>inspectRoster(roster);
 if(letters)$('obsLetters').onclick=()=>reviewObsLetters(letters);
 if(failed.length)$('obsHelp').onclick=()=>obsDiagnostics(failed[0].error.code);
 $('obsOther').onclick=()=>obsConnect();
}

function obsShowLauncher(){
  const launch=document.getElementById('obsLaunch');
  if(launch&&/Windows/i.test(navigator.userAgent)){
   launch.hidden=false;
   launch.querySelector('.obs-open').addEventListener('click',()=>{
    const setup=$('obsSetup');
    dialog('OBS bağlantısını aç', '<p>Windows onay isterse <strong>Aç</strong> seçeneğini seçin. OBS köprüsü kuruluysa yerel sekme açılır.</p><details open><summary>İlk kez mi kullanıyorsunuz?</summary>'+Array.from(setup.querySelectorAll('p'),p=>p.outerHTML).join('')+'</details>'+btn('Kapat','modal.close()'));
   });
  }
}

async function obsDetect(){
 if(location.hostname!=='127.0.0.1')return obsShowLauncher();
 let click=()=>obsConnect(),state;
 try{state=await obsJson('durum')}
 catch(error){
  // Opened without the key: explain it on click. Any other local server has no bridge at all.
  if(error.code!=='anahtar')return obsShowLauncher();
  click=()=>obsFailed(error,{active:()=>true},()=>{});
 }
 for(const button of document.querySelectorAll('.obs-connect')){
  button.hidden=false;
  button.onclick=click;
 }
 $('obsPanel').hidden=true;
 obsAvailable=true;
 for(const button of document.querySelectorAll('.obs-only'))button.hidden=false;
 obsConnected(state?.durum==='bagli');
 if(location.hash==='#obs'){history.replaceState(null,'',location.pathname);click()}
}
obsDetect();
