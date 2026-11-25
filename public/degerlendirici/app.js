const sections=[
 ["Dosya Kapağı ve Belgeler Listesi","Ders bilgileri ve işaretli içindekiler listesi","files","Ders bilgilerini kullanarak yazdırılabilir bir kapak oluşturun veya kendi kapağınızı ekleyin."],
 ["Ders İzlencesi","Dersin içeriği ve öğrenme çıktıları","book-open","Güncel izlenceyi PDF, DOCX, TXT veya taranmış görüntü olarak ekleyin. Okunan ders bilgilerini ve ana öğrenme çıktılarını kontrol edin."],
 ["Öğrenci Devam Çizelgesi","OBS genel yoklama çıktısı","calendar-check","OBS’de Yazdır › Genel Yoklama üzerinden aldığınız dönemlik çizelgeyi ekleyin."],
 ["Harf Notları ve İstatistikler","Dönem sonu notları ve sınav histogramları","chart-column","Harf notu çıktısını, harf dağılımını ve sınav histogramlarını ekleyin."],
 ["Faaliyet ve Not Tablosu","Soru bazında puanlar ve ÖÇ eşleştirmeleri","table-2","Puanları XLS, XLSX veya UTF-8 CSV olarak yükleyebilirsiniz. Öğrenci No ile en az bir soru, Ham Not veya Harf Notu sütunu gerekir. Mazeret ve bütünleme isteğe bağlıdır."],
 ["Ders Değerlendirme Raporu","Sınav sonuçları ve dersin değerlendirmesi","notebook-pen","Ders özelindeki yorumları ve harf dağılımını içeren raporu ekleyin veya hazırlayın."],
 ["Cevap Anahtarları","Uygulanan sınavların cevap anahtarları","key-round","Uygulanan her sınavın cevap anahtarını eklediğinizi kontrol edin."],
 ["Öğrenci Faaliyet Örnekleri","Sınav kâğıtları, ödevler ve sunumlar","folder-open","Her sınav için başarılı öğrencilerden en düşük, ortalamaya en yakın ve en yüksek puanlı çalışmaları ve dönem içi faaliyet örneklerini ekleyin."]
];
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icon=n=>'<i data-lucide="'+n+'"></i>';
const icons=()=>lucide.createIcons();
const btn=(label,act,i="")=>'<button onclick="'+act+'">'+(i?icon(i):'')+label+'</button>';
let db,course,courseList=[],filter=0,opened=-1,target=0,timer;
const modal=$("modal");
function notify(msg){clearTimeout(timer);$("toast").textContent=msg;timer=setTimeout(()=>$("toast").textContent="",4800)}
function dialog(title,body){
 $("modalbody").innerHTML='<div class="mhead"><h2 id="modalTitle" tabindex="-1">'+esc(title)+'</h2><button type="button" aria-label="Kapat" onclick="modal.close()">'+icon('x')+'</button></div>'+body;
 modal.setAttribute('aria-labelledby','modalTitle');
 if(!modal.open)modal.showModal();
 icons();
 modal.scrollTop=0;
 $('modalTitle').focus({preventScroll:true});
}
const newCourses=new WeakSet();
function fresh(name,code){
 const record={id:crypto.randomUUID(),name,code,term:'',teacher:'',outcomes:'',files:Array.from({length:8},()=>[]),done:Array(8).fill(false),cover:false,report:'',distribution:{},sheets:{}};
 newCourses.add(record);
 return record;
}
let retentionRequested=false;
function requestLocalRetention(){
 if(retentionRequested||!navigator.storage?.persist||!navigator.userActivation?.hasBeenActive)return;
 retentionRequested=true;
 navigator.storage.persist().catch(()=>{});
}
function persist(record=course){
 requestLocalRetention();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('courses','readwrite'),store=tx.objectStore('courses');
  let revision,conflict=false;
  const read=store.get(record.id);
  read.onsuccess=()=>{
   const stored=read.result;
   if((!stored&&!newCourses.has(record))||(stored?.storageRevision??0)!==(record.storageRevision??0)){
    conflict=true;tx.abort();return;
   }
   revision=(record.storageRevision??0)+1;
   store.put({...record,storageRevision:revision});
  };
  tx.oncomplete=()=>{record.storageRevision=revision;newCourses.delete(record);resolve()};
  tx.onabort=()=>{
   const reason=conflict?'Bu ders başka bir sekmede değişti. Güncel kayıtları açmak için sayfayı yenileyin.':
    tx.error?.name==='QuotaExceededError'?'Cihazda yeterli alan yok. Son değişiklik kaydedilemedi.':'Bu dersteki son değişiklik tarayıcıya kaydedilemedi.';
   notify(reason);reject(new Error(reason));
  };
 });
}
async function save(){await persist();render()}
$('homeLink').addEventListener('click',async event=>{
 if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
 event.preventDefault();
 if(!$('gradePage').hidden)await saveGrades();
 opened=-1;filter=0;render();
 const heading=$('dashboard').querySelector('h1');
 heading.tabIndex=-1;heading.focus({preventScroll:true});window.scrollTo(0,0);
});
function untouchedStarterCourse(record){
 // The former starter was saved once and had no form fields. Any later edit or extra data keeps it.
 const allowed=new Set(['id','name','code','term','teacher','outcomes','files','done','cover','report','distribution','sheets','storageRevision']);
 return record.name==='Ekoloji'&&record.code==='MBG174'&&
  Object.keys(record).every(key=>allowed.has(key))&&
  (record.storageRevision===undefined||record.storageRevision===1)&&
  record.term===''&&record.teacher===''&&record.outcomes===''&&record.cover===false&&record.report===''&&
  Array.isArray(record.files)&&record.files.length===sections.length&&record.files.every(group=>Array.isArray(group)&&!group.length)&&
  Array.isArray(record.done)&&record.done.length===sections.length&&record.done.every(value=>value===false)&&
  record.distribution&&Object.keys(record.distribution).length===0&&record.sheets&&Object.keys(record.sheets).length===0;
}
async function init(){
 db=await new Promise((resolve,reject)=>{
  const request=indexedDB.open('degerlendirici-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('courses',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
 await importPreviousCourses(db).catch(() => notify('Önceki dersler aktarılamadı. Yeniden denemek için sayfayı yenileyin.'));
 courseList=await new Promise((resolve,reject)=>{
  const tx=db.transaction('courses','readwrite'),store=tx.objectStore('courses'),request=store.getAll();
  const records=[];
  request.onsuccess=()=>{
   for(const record of request.result){
    if(untouchedStarterCourse(record))store.delete(record.id);
    else records.push(record);
   }
  };
  tx.oncomplete=()=>resolve(records);
  tx.onabort=()=>reject(tx.error);
 });
 course=courseList.find(record=>record.id===localStorage.selectedCourse)||courseList[0];
 if(!course)localStorage.removeItem('selectedCourse');
 render();
}
async function confirmCourseDelete(){
 const record=course;
 if(!record||!window.confirm('“'+record.code+' · '+record.name+'” dersi, belgeleri ve öğrenci kayıtlarıyla birlikte bu cihazdan kalıcı olarak silinsin mi?'))return;
 const button=$('deleteCourse');
 if(button)button.disabled=true;
 try{
  courseList=await new Promise((resolve,reject)=>{
   const tx=db.transaction('courses','readwrite'),store=tx.objectStore('courses'),request=store.get(record.id);
   let conflict=false,remaining;
   request.onsuccess=()=>{
    const stored=request.result;
    if(stored&&(stored.storageRevision??0)!==(record.storageRevision??0)){
     conflict=true;tx.abort();return;
    }
    store.delete(record.id);
    remaining=store.getAll();
   };
   tx.oncomplete=()=>resolve(remaining.result);
   tx.onabort=()=>reject(new Error(conflict?'Bu ders başka bir sekmede değişti. Silmeden önce sayfayı yenileyin.':'Ders silinemedi. Yeniden deneyin.'));
  });
 }catch(error){
  if(button)button.disabled=false;
  window.alert(error.message);
  return;
 }
 course=courseList[0];
 if(course)localStorage.selectedCourse=course.id;
 else localStorage.removeItem('selectedCourse');
 opened=-1;filter=0;
 modal.close();
 $('modalbody').replaceChildren();
 render();
 $(course?'courses':'firstCourse').focus();
}
function populated(i){return course.files[i].length||i===0&&(course.cover||names().length)||i===3&&dist().total||i===4&&Object.keys(course.sheets).length||i===5&&(course.report||names().length)}
function toggleSection(i){
 opened=opened===i?-1:i;
 render();
 $('documentRow'+i).focus({preventScroll:true});
}
function render(){
 const preview=!course;
 $('emptyCourses').hidden=!preview;
 $('selectedCoursePanel').hidden=preview;
 $('dashboardGrid').hidden=false;
 $('pack').hidden=false;
 $('pack').disabled=preview;
 if(preview)$('pack').setAttribute('aria-describedby','previewStatus');
 else $('pack').removeAttribute('aria-describedby');
 $('tabs').hidden=preview;
 $('previewListHelp').hidden=!preview;
 $('packageProgress').hidden=preview;
 $('previewStatus').hidden=!preview;
 $("courses").innerHTML=courseList.map(c=>'<option value="'+esc(c.id)+'" '+(c===course?'selected':'')+'>'+esc(c.code+' · '+c.name+(c.term?' · '+c.term:''))+'</option>').join('');
 const selected=$('courses').selectedOptions[0];$('mobileCourse').textContent=selected?.textContent||'';
 if(course){
  const count=course.done.filter(Boolean).length;
  $('count').textContent=count;
  $('percent').textContent='%'+Math.round(100*count/sections.length);
  $('progress').style.width=100*count/sections.length+'%';
  $('tabs').innerHTML=['Tümü','Eksikler','Tamamlananlar'].map((label,i)=>'<button class="'+(filter===i?'active':'')+'" onclick="filter='+i+';render()">'+label+'</button>').join('');
 }
 $('rows').innerHTML=sections.map(([name,subtitle,sectionIcon,description],i)=>{
  const done=course?.done[i];
  if(course&&(filter===1&&done||filter===2&&!done))return '';
  const review=course&&!done&&populated(i);
  const expanded=opened===i;
  const badge=preview?'':'<span class="badge '+(done?'ready':review?'review':'missing')+'">'+(done?'Tamamlandı':review?'Kontrol':'Eksik')+'</span>';
  const row='<button class="row" id="documentRow'+i+'" aria-expanded="'+expanded+'" onclick="toggleSection('+i+')"><span class="docicon">'+icon(sectionIcon)+'</span><span class="rowtext"><span class="rowtitle">'+esc(name)+'</span><span class="sub">'+esc(subtitle)+'</span></span>'+badge+icon(expanded?'chevron-up':'chevron-down')+'</button>';
  if(!expanded)return row;
  return row+(preview?'<div class="detail"><p>'+esc(description)+'</p></div>':detail(i));
 }).join('')||'<p class="empty">Bu görünümde bölüm bulunmuyor.</p>';
 $('quick').innerHTML=[
  ['Dosya yükle','Belgeyi bir bölüme ekle','upload','pickSection()'],
  ['Sınavlar','Sınav tanımla ve soru ayarlarını düzenle','clipboard-list','examManager()'],
  ['Not tablosu','Sınavları ve puanları düzenle','sheet','grades()'],
  ['Öğrenme çıktıları','ÖÇ listesini ve eşleşmeleri yönet','git-branch','outcomes()']
 ].map(([name,subtitle,actionIcon,action])=>{
  const attributes=preview?'disabled aria-describedby="previewStatus"':'onclick="'+action+'"';
  return '<button '+attributes+'><span class="actionicon">'+icon(actionIcon)+'</span><span><b>'+name+'</b><span class="sub">'+subtitle+'</span></span>'+icon('chevron-right')+'</button>';
 }).join('');
 icons();
}
function detail(i){return '<div class="detail"><p>'+sections[i][3]+'</p>'+attachmentList(i)+'<div class="actions">'+(i===0?btn(course.cover?'Kapağı görüntüle':'Kapak oluştur','coverView()','file-text'):i===1?btn('İzlenceyi oku','readSyllabus()','scan-text'):i===3?btn('Harf dağılımı ve barem','statsView()','chart-column'):i===4?btn('Tabloyu düzenle','grades()','sheet'):i===5?btn('Rapor hazırla','reportView()','notebook-pen'):'')+(populated(i)?btn(course.done[i]?'Yeniden incele':'Kontrol ettim, tamamla','mark('+i+')','check'):'')+((populated(i)||i===0||i===5&&names().length)?btn('Bölümü indir','componentDownload('+i+')','download'):'')+'</div><div class="drop" ondragover="event.preventDefault();this.classList.add(\'drag\')" ondragleave="this.classList.remove(\'drag\')" ondrop="event.preventDefault();upload('+i+',Array.from(event.dataTransfer.files))">'+btn('Dosya seç','pick('+i+')','upload')+' <span class="sub">veya dosyaları buraya bırakın</span></div></div>'}
async function mark(i){course.done[i]=!course.done[i];await save()}
const titles=['Prof. Dr.','Doç. Dr.','Dr. Öğr. Üyesi','Öğr. Gör. Dr.','Öğr. Gör.','Arş. Gör. Dr.','Arş. Gör.','Dr.','Prof.','Doç.'];
function parseTeacher(text=''){
 const title=titles.find(t=>text.startsWith(t))||'';
 const words=text.slice(title.length).trim().split(/\s+/).filter(Boolean);
 let split=words.findIndex((w,i)=>i>0 && w===w.toLocaleUpperCase('tr-TR'));
 if(split<0)split=Math.max(1,words.length-1);
 return {title,given:words.slice(0,split).join(' '),family:words.slice(split).join(' ')};
}
function parseTerm(text=''){
 const y=text.match(/((?:19|20)\d{2})\s*[-–—/]\s*((?:19|20)\d{2})/);
 // Prefer the term beside the academic year or an explicit term label in a syllabus.
 const termWord=/(?<![\p{L}\p{M}\d])(güz|bahar|yaz)(?![\p{L}\p{M}\d])/iu;
 const afterYear=y?text.slice(y.index+y[0].length).match(/^[\s|,/:–—-]*(güz|bahar|yaz)(?![\p{L}\p{M}\d])/iu):null;
 const labeled=text.match(/(?:dönem(?:i)?|yarıyıl(?:ı)?)\s*[:：|]\s*(güz|bahar|yaz)(?![\p{L}\p{M}\d])/iu);
 const season=(afterYear||labeled||text.match(termWord))?.[1]||'';
 return {year:y?y[1]+'–'+y[2]:'',season:season?season[0].toUpperCase()+season.slice(1).toLocaleLowerCase('tr-TR'):''};
}
function courseFields(c){
 const meta={...parseTerm(c.term),...parseTeacher(c.teacher),...c};
 const thisYear=new Date().getFullYear();
 const years=Array.from({length:25},(_,i)=>thisYear+4-i).map(y=>y+'–'+(y+1));
 function select(k,l,options){const list=Array.from(new Set([...options,...(meta[k]?[meta[k]]:[])]));return '<label>'+l+'<select name="'+k+'"><option value="">Seçiniz</option>'+list.map(v=>'<option '+(v===meta[k]?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>'}
 function input(k,l){return '<label>'+l+'<input name="'+k+'" '+(['name','code'].includes(k)?'required':'')+' value="'+esc(meta[k]||'')+'"></label>'}
 return input('code','Ders kodu')+input('name','Ders adı')+'<div class="fieldpair">'+select('year','Akademik yıl',years)+select('season','Dönem',['Güz','Bahar','Yaz'])+'</div><fieldset><legend>Sorumlu öğretim elemanı</legend>'+select('title','Ünvan',titles)+'<div class="fieldpair">'+input('given','Adı / adları')+input('family','Soyadı / soyadları')+'</div></fieldset>';
}
function teacherName(c,cover=false){
 const parts={...parseTeacher(c.teacher),...c};
 const given=cover?parts.given.toLocaleLowerCase('tr-TR').replace(/(^|[\s-])(\p{L})/gu,(_,s,l)=>s+l.toLocaleUpperCase('tr-TR')):parts.given;
 return [parts.title,given,cover?parts.family.toLocaleUpperCase('tr-TR'):parts.family].filter(Boolean).join(' ');
}
function storeCourseFields(form){
 const values=Object.fromEntries(new FormData(form));
 for(const key of ['name','code','year','season','title','given','family'])course[key]=values[key].trim().replace(/\s+/g,' ');
 course.term=[course.year,course.season].filter(Boolean).join(' ');
 course.teacher=teacherName(course);
}
function courseForm(add){
 const owner=course;
 const syllabus='<fieldset><legend>Ders izlencesi</legend><label>Dosya seç (isteğe bağlı)<input id="courseSyllabus" type="file" accept=".pdf,.docx,.txt,image/*"></label><p id="courseSyllabusStatus" role="status">Bir dosya seçerek ders bilgilerini ve ana öğrenme çıktılarını otomatik doldurabilirsiniz.</p></fieldset>';
 dialog(add?'Yeni ders':'Ders bilgileri','<form id="form" autocomplete="off">'+syllabus+
  courseFields(add?{}:owner)+'<div id="courseSyllabusOutcomes" hidden></div>'+
  '<div class="actions"><button class="primary" type="submit">Kaydet</button><button type="button" onclick="modal.close()">Vazgeç</button>'+
  (add?'':'<button id="deleteCourse" type="button" onclick="confirmCourseDelete()">Dersi sil</button>')+'</div></form>');
 const form=$('form'),picker=$('courseSyllabus'),status=$('courseSyllabusStatus');
 const outcomeSection=$('courseSyllabusOutcomes');
 const submit=form.querySelector('[type=submit]');
 let stagedFile=null,busy=false;
 const active=()=>form.isConnected&&modal.open&&course===owner;

 picker.onchange=async()=>{
  const file=picker.files[0];
  if(!file)return;
  stagedFile=file;
  busy=picker.disabled=submit.disabled=true;
  status.textContent='İzlence okunuyor…';
  const before=Object.fromEntries(new FormData(form));
  try{
   const text=syllabusTextCache.get(file)??await extractText(file,page=>{
    if(!active())throw new DOMException('İzlence okuma iptal edildi.','AbortError');
    status.textContent='Sayfa '+page+' okunuyor…';
   });
   if(!active())return;
   if(text.trim())syllabusTextCache.set(file,text);
   const {outcomes:foundOutcomes,...fields}=syllabusFields(text);
   const values=Object.fromEntries(new FormData(form));
   const detected=Object.entries(fields).filter(([,value])=>value);
   for(const [key,value] of detected){
    const input=form.elements.namedItem(key);
    if(!input||values[key]!==before[key])continue;
    if(input instanceof HTMLSelectElement&&!Array.from(input.options).some(option=>option.value===value))input.add(new Option(value,value));
    input.value=value;
   }
   if(foundOutcomes){
    outcomeSection.innerHTML='<h3>Ana öğrenme çıktıları</h3>'+outcomeEditor(parseOutcomeList(foundOutcomes));
    outcomeSection.hidden=false;
    icons();
   }
   status.textContent=detected.length||foundOutcomes
    ?'Okunan bilgileri kontrol edin. Dosya kaydederken ders izlencesine eklenir.'
    :'Ders bilgileri bulunamadı. Bilgileri elle girebilirsiniz. Dosya kaydederken ders izlencesine eklenir.';
  }catch(error){
   if(!active())return;
   console.error('İzlence okuma hatası',error);
   status.textContent='İzlence okunamadı. Bilgileri elle girebilirsiniz. Dosya kaydederken ders izlencesine eklenir.';
  }finally{
   busy=picker.disabled=submit.disabled=false;
  }
 };

 form.onsubmit=async event=>{
  event.preventDefault();
  if(busy||!active())return;
  const edit=outcomeSection.hidden?null:readOutcomeRows();
  if(!outcomeSection.hidden&&!edit)return;
  busy=picker.disabled=submit.disabled=true;
  const editing=add?fresh('',''):{...owner};
  const deleteButton=$('deleteCourse');
  if(deleteButton)deleteButton.disabled=true;
  try{
   if(edit)editing.sheets=Object.fromEntries(Object.entries(editing.sheets).map(([name,sheet])=>[name,{...sheet}]));
   course=editing;
   try{
    storeCourseFields(form);
    if(edit)storeOutcomes(edit);
   }finally{
    course=owner;
   }
   if(stagedFile){
    editing.files=editing.files.map((files,index)=>index===1?[...files,stagedFile]:files);
    editing.done=editing.done.map((done,index)=>index===1?false:done);
   }
   await persist(editing);
  }finally{
   busy=picker.disabled=submit.disabled=false;
   if(deleteButton)deleteButton.disabled=false;
  }
  if(add)courseList.push(editing);
  else Object.assign(owner,editing);
  if(course===owner){
   if(add){course=editing;opened=-1;filter=0}
   localStorage.selectedCourse=editing.id;
   render();
   if(form.isConnected&&modal.open){
    modal.close();
    if(add&&!owner)$('courses').focus({preventScroll:true});
   }
  }
 };
}
$("firstCourse").onclick=$("add").onclick=()=>courseForm(true);$("edit").onclick=()=>courseForm(false);$("courses").onchange=e=>{course=courseList.find(c=>c.id===e.target.value);localStorage.selectedCourse=course.id;opened=-1;filter=0;render()};
function pickSection(){dialog('Dosya yükle','<label>Belge bölümü<select id="section">'+sections.map(([n],i)=>'<option value="'+i+'">'+n+'</option>').join('')+'</select></label>'+btn('Dosya seç','pick(Number($(\'section\').value))','upload'))}
function pickGrades(){pick(4,'.xls,.xlsx,.csv')}
function pick(i,accept=''){target=i;document.getElementById('files').accept=accept;$("files").value='';$("files").click()}
$("files").onchange=e=>upload(target,Array.from(e.target.files));
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000)}
function getFile(i,j){const f=course.files[i][j];download(f,i===6||i===7?sectionFilenames(i)[j]:f.name)}
async function upload(i,files){
 if(!files.length)return;
 const owner=course;
 if(i===6||i===7){classifyFiles(i,files);return}
 const title=$('modalTitle'),wasOpen=modal.open,desk=$('gradeDesk');
 const priorOpen=opened,priorFilter=filter;
 const sameView=()=>course===owner&&$('modalTitle')===title&&$('gradeDesk')===desk;
 const sameDialog=()=>sameView()&&modal.open===wasOpen;
 let parsedWorkbook;
 if((i===2||i===4)&&files.length===1&&/\.(pdf|xlsx?|csv)$/i.test(files[0].name)){
  let roster;
  try{
   if(/\.pdf$/i.test(files[0].name))roster=await readRoster(files[0],false);
   else{parsedWorkbook=await readBook(files[0]);roster=rosterWorkbook(parsedWorkbook)}
  }catch{/* Preserve the uploaded file even if its contents cannot be previewed. */}
  if(course!==owner){notify('Ders değişti. Dosyayı ilgili derste yeniden seçin.');return}
  if(roster?.examList&&roster.entries.length){
   if(sameDialog()&&opened===priorOpen&&filter===priorFilter)showRoster(roster,files[0].name);
   return;
  }
 }
 const review=sameDialog()&&opened===priorOpen&&filter===priorFilter;
 course.files[i].push(...files);course.done[i]=false;
 if(review){opened=i;filter=0}
 await save();
 if(course!==owner)return;
 notify('Dosyalar bölüme eklendi.');
 if(!review||!sameDialog()||opened!==i||filter!==0)return;
 if(modal.open)modal.close();
 if(i===1)await readSyllabus();
 else if(i===4||i===3){
  const file=files.find(f=>/\.(xlsx?|csv)$/i.test(f.name));
  if(file)await importBook(file,parsedWorkbook);
  else if(i===3&&files.length===1&&/\.pdf$/i.test(files[0].name))await reviewObsLetters(files[0]);
 }else if(i===2&&/\.(xlsx?|csv)$/i.test(files[0].name)){
  let workbook;
  try{workbook=parsedWorkbook||await readBook(files[0])}catch{
   if(sameView()&&!modal.open&&opened===i&&filter===0)notify('Dosya saklandı. Devam çizelgesi önizlenemedi.');
   return;
  }
  if(sameView()&&!modal.open&&opened===i&&filter===0)dialog('Devam çizelgesi önizlemesi',workbook.SheetNames.map(n=>'<h3>'+esc(n)+'</h3>'+previewTable(matrix(workbook,n).slice(0,8))).join('')+btn('Kapat','modal.close()'));
 }
}
function packageDialog(){let missing=sections.filter((s,i)=>!course.done[i]);dialog('Ders paketini indir','<p>'+esc(course.code+' · '+course.name)+'</p>'+(missing.length?'<h3>Kontrolü tamamlanmamış bölümler</h3><ul class="package-checklist">'+missing.map(([n])=>'<li>'+n+'</li>').join('')+'</ul>':'<p>Sekiz bölümün tamamı hazır.</p>')+'<div class="actions">'+btn(missing.length?'Taslak ZIP indir':'ZIP indir','makeZip()','download')+'</div>')}
$("pack").onclick=packageDialog;
window.addEventListener('unhandledrejection',e=>{notify('İşlem tamamlanamadı. '+(e.reason?.message||'Tarayıcı depolama alanını kontrol edin.'))});


async function removeFile(i,j){
 const file=course.files[i][j];
 dialog('Dosyayı paketten kaldır','<p>'+esc(file.name)+'</p><p>Bu dosyanın paketteki kopyası kaldırılacak.</p><div class="actions">'+btn('Vazgeç','modal.close()')+btn('Paketten kaldır','confirmRemove('+i+','+j+')')+'</div>');
}
async function confirmRemove(i,j){if(i===3&&course.obsLetters?.key===obsFileKey(course.files[i][j]))delete course.obsLetters;course.files[i].splice(j,1);course.fileTags?.[i]?.splice(j,1);course.done[i]=false;await save();modal.close()}






async function retireLegacyCache(){
 if('serviceWorker' in navigator){
  try{
   const registration=await navigator.serviceWorker.getRegistration();
   const legacy=new URL('/model-cache.js',location.origin).href;
   const workers=[registration?.installing,registration?.waiting,registration?.active].filter(Boolean);
   if(workers.length&&workers.every(worker=>worker.scriptURL===legacy))await registration.unregister();
  }catch{/* Access may be disabled in private browsing. */}
 }
 if('caches' in window){
  for(const name of await caches.keys()){
   if(name.startsWith('degerlendirici-ai-'))await caches.delete(name);
  }
 }
}
retireLegacyCache().catch(()=>{});
