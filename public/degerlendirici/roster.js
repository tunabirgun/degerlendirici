function cleanRosterText(v){return String(v??'').normalize('NFC').replace(/\s+/g,' ').trim()}
function blankRoster(){return {code:'',name:'',entries:[],conflicts:[],duplicates:0,examList:false}}
function dedupRoster(result){
 const unique=new Map(),alternatives=new Map();
 for(let [id,name] of result.entries){
  id=cleanRosterText(id);name=cleanRosterText(name);
  if(!/^\d{5,20}$/.test(id)||(!name&&!result.scanned))continue;
  if(unique.has(id)){
   const existing=unique.get(id);
   if(!existing&&name)unique.set(id,name);
   else if(name&&existing.toLocaleLowerCase('tr')!==name.toLocaleLowerCase('tr')){
    if(!alternatives.has(id))alternatives.set(id,new Set([existing]));
    alternatives.get(id).add(name);
   }
   result.duplicates++;
  }else unique.set(id,name);
 }
 result.entries=Array.from(unique);
 result.alternatives=Object.fromEntries(Array.from(alternatives,([id,names])=>[id,Array.from(names)]));
 result.conflicts=Array.from(alternatives.keys());
 return result;
}
function studentNameColumns(header){
 const labels=header.map(v=>norm(cleanRosterText(v)));
 const name=labels.findIndex(v=>/^(ogrenci(nin)? )?adi?\s*(ve\s*)?soyadi?$/.test(v));
 if(name>=0)return [name,-1];
 const family=labels.findIndex(v=>/^(ogrenci(nin)? )?soyadi?$/.test(v));
 const given=labels.findIndex(v=>/^(ogrenci(nin)? )?adi?$|^isim$/.test(v));
 return family>=0&&given>=0?[given,family]:[-1,-1];
}
function studentName(row,[name,family]){
 return cleanRosterText([row[name],row[family]].filter(Boolean).join(' '));
}
function rosterWorkbook(w){
 const out=blankRoster();
 for(const tab of w.SheetNames){
  // OBS may store a numeric ID with a zero-padded Excel display format.
  const rows=XLSX.utils.sheet_to_json(w.Sheets[tab],{header:1,defval:'',blankrows:false,raw:false});
  let id=-1,columns=[];
  for(const row of rows){
   if(row.some(v=>norm(v).includes('sinav yoklama listesi')))out.examList=true;
   const labels=row.findIndex(v=>norm(v).includes('ders kodu')&&String(v).includes('\n'));
   if(labels>=0){
    const keys=String(row[labels]).split(/\r?\n/).map(norm);
    const vals=row.slice(labels+1).find(v=>String(v).includes('\n')&&/\p{L}/u.test(v));
    if(vals){const lines=String(vals).split(/\r?\n/);out.code=cleanRosterText(lines[keys.indexOf('ders kodu')]);out.name=cleanRosterText(lines[keys.indexOf('ders adi')])}
   }
   const headings=row.map(v=>norm(cleanRosterText(v)));
   const k=headings.findIndex(v=>/^(ogrenci (no|numarasi)|numara)\.?$/.test(v));
   if(k>=0){
    id=k;columns=studentNameColumns(row);
    continue;
   }
   if(id>=0&&columns[0]>=0)out.entries.push([row[id],studentName(row,columns)]);
  }
 }
 return dedupRoster(out);
}
async function rosterPdf(file,scan=true){
 if(typeof pdfjsLib==='undefined')await loadLibrary('pdfjsLib');
 pdfjsLib.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';
 const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise,out=blankRoster();
 let scanWorker;
 try{
  for(let pageNum=1;pageNum<=pdf.numPages;pageNum++){
   const page=await pdf.getPage(pageNum);
   const cells=(await page.getTextContent()).items.filter(it=>it.str?.trim()).map(it=>({v:cleanRosterText(it.str),x:it.transform[4],y:it.transform[5]}));
   if(cells.some(c=>norm(c.v).includes('sinav yoklama listesi')))out.examList=true;
   function meta(label){
    const head=cells.find(c=>norm(c.v)===label);
    return head?cells.filter(c=>Math.abs(c.y-head.y)<2&&c.x>head.x+5&&c.v!==':').sort((a,b)=>a.x-b.x).map(c=>c.v).join(' ').replace(/^:\s*/,''):'';
   }
   out.code||=meta('ders kodu');out.name||=meta('ders adi');
   const idHead=cells.find(c=>/^ogrenci (no|numarasi)/.test(norm(c.v)));
   const headerCells=idHead?cells.filter(c=>Math.abs(c.y-idHead.y)<4&&c.x>idHead.x):[];
   const joined=headerCells.find(c=>/ad[i]?\s*(ve\s*)?soyad/.test(norm(c.v)));
   const first=headerCells.find(c=>/^adi?$/.test(norm(c.v)));
   const last=headerCells.find(c=>/^soyadi?$/.test(norm(c.v))&&first&&c.x>first.x);
   const nameHead=joined||(last&&first);
   if(!idHead||!nameHead){
    if(scan){
     const viewport=page.getViewport({scale:2100/page.getViewport({scale:1}).width}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;
     try{
      await page.render({viewport,canvasContext:canvas.getContext('2d')}).promise;
      scanWorker??=await createRosterWorker();
      let read=await scanRosterOrientations(canvas,scanWorker);
      if(!read.entries.length){
       // Photocopies embedded at low resolution can lose column boundaries
       // when interpolated. Retry at a different scale and sparse-text layout.
       console.info('Yoklama OCR · ilk geçiş '+JSON.stringify(read.scanStats));
       const retry=page.getViewport({scale:1550/page.getViewport({scale:1}).width});
       canvas.width=Math.ceil(retry.width);canvas.height=Math.ceil(retry.height);
       await page.render({viewport:retry,canvasContext:canvas.getContext('2d')}).promise;
       read=await scanRosterPage(canvas,scanWorker,'11');
       if(!read.entries.length)console.info('Yoklama OCR · ikinci geçiş '+JSON.stringify(read.scanStats));
      }
      out.scanned=true;out.code||=read.code;out.name||=read.name;out.examList||=read.examList;out.entries.push(...read.entries);(out.uncertain??=[]).push(...read.uncertain||[]);out.skipped=(out.skipped||0)+(read.skipped||0);
     }finally{canvas.width=0}
    }
    page.cleanup();continue;
   }
   const endHeader=joined||last;
   const right=Math.min(...headerCells.filter(c=>c.x>endHeader.x+7).map(c=>c.x),Infinity);
   const ids=cells.filter(c=>/^\d{5,20}$/.test(c.v)&&c.y<idHead.y&&Math.abs(c.x-idHead.x)<12).sort((a,b)=>b.y-a.y);
   for(const [i,id] of ids.entries()){
    const upper=i?(id.y+ids[i-1].y)/2:id.y+10,lower=i+1<ids.length?(id.y+ids[i+1].y)/2:id.y-10;
    const name=cells.filter(c=>c.y<=upper&&c.y>lower&&c.x>=nameHead.x-5&&c.x<right-3).sort((a,b)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x).map(c=>c.v).join(' ');
    out.entries.push([id.v,name]);
   }
   page.cleanup();
  }
 }finally{try{await scanWorker?.terminate()}finally{await pdf.destroy()}}
 return dedupRoster(out);
}
let rosterRequest;
function chooseRoster(){const input=document.createElement('input');input.type='file';input.accept='.pdf,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp';input.onchange=()=>{if(input.files[0])inspectRoster(input.files[0])};input.click()}
async function readRoster(file,scan=true){if(/\.(png|jpe?g|webp)$/i.test(file.name))return readRosterImage(file);return /\.pdf$/i.test(file.name)?rosterPdf(file,scan):rosterWorkbook(await readBook(file))}
async function inspectRoster(file){
 const owner=course;
 dialog('OBS yoklama dosyası','<p id="rosterRead" role="status">Öğrenci listesi okunuyor…</p>');
 const reading=$('rosterRead'),active=()=>course===owner&&modal.open&&reading.isConnected;
 try{
  const list=await readRoster(file);
  if(active())showRoster(list,file.name);
 }catch{
  if(active())dialog('OBS yoklama dosyası','<p>Liste okunamadı. Ders veya sınav yoklamasını Excel, CSV, PDF ya da okunaklı bir görüntü olarak seçin.</p>'+btn('Dosya seç','chooseRoster()','upload'));
 }
}
function showRoster(list,filename){
 if(!list.entries.length){dialog('OBS yoklama dosyası','<p>'+(list.scanned?'Taramadaki öğrenci numaraları ayırt edilemedi. OBS’nin Excel çıktısını veya daha net bir taramayı seçin.':'Öğrenci No ve Adı Soyadı sütunlarında öğrenci bulunamadı.')+'</p>'+btn('Başka dosya seç','chooseRoster()','upload'));return}
 const match=list.code&&norm(list.code)!==norm(course.code)?courseList.find(c=>norm(c.code)===norm(list.code)):course;
 rosterRequest={list,filename};
 dialog('Yoklama dosyasından okunan öğrenciler','<p>'+esc(filename)+' · '+list.entries.length+' öğrenci'+(list.duplicates?' · '+list.duplicates+' yinelenen satır':'')+'</p><label>Ders<select id="rosterCourse">'+courseList.map(c=>'<option value="'+esc(c.id)+'" '+(match===c?'selected':'')+'>'+esc(c.code+' · '+c.name+(c.term?' · '+c.term:''))+'</option>').join('')+(list.code?'<option value="new" '+(!match?'selected':'')+'>Yeni ders — '+esc(list.code+' · '+list.name)+'</option>':'')+'</select></label>'+(list.scanned?'<div class="fieldpair" id="rosterNewFields"><label>Yeni dersin kodu<input id="scanCode" value="'+esc(list.code)+'"></label><label>Yeni dersin adı<input id="scanName" value="'+esc(list.name)+'"></label></div>':'')+'<label><input type="checkbox" id="rosterApply" checked> Öğrenci numaralı sınavlara eksik öğrencileri ekle</label><p>Yeni sınavlar dersin öğrenci listesiyle açılır. Mevcut puanlar korunur.</p>'+rosterPreview(list)+(list.conflicts.length?'<p>Aynı numara için farklı adlar bulundu. İşaretli satırlarda doğru adı seçin veya yazın.</p>':'')+'<div class="actions">'+btn('Listeyi aktar','acceptRoster()','check')+btn('Vazgeç','modal.close()')+'</div>');
 const target=$('rosterCourse');
 function refreshTarget(){
  const newFields=$('rosterNewFields');
  if(newFields){
   newFields.hidden=target.value!=='new';
   newFields.style.display=newFields.hidden?'none':'';
  }
  rosterRequest.references=rosterReferences(courseList.find(c=>c.id===target.value));
  document.querySelectorAll('#rosterReview tr[data-record]').forEach(tr=>updateRosterReview(tr));
 }
 target.addEventListener('change',refreshTarget);
 $('rosterReview').addEventListener('input',event=>{
  const tr=event.target.closest('tr[data-record]');
  if(!tr)return;
  if(event.target.hasAttribute('data-id'))updateRosterReview(tr);
  if(event.target.hasAttribute('data-name')){
   tr.dataset.editedName=event.target.value;
   tr.querySelector('[data-confirm]').checked=false;
  }
 });
 refreshTarget();
}
function rosterReferences(selected){
 const refs=new Map();
 if(!selected)return refs;
 for(const [code,name] of selected.roster||[]){
  const id=cleanRosterText(code),text=cleanRosterText(name);
  if(id&&text)refs.set(id,{name:text,source:'Ders listesi',sheets:new Set()});
 }
 for(const sheet of Object.values(selected.sheets||{})){
  if(sheet.anonymous)continue;
  for(const [code,name] of sheet.rows||[]){
   const id=cleanRosterText(code),text=cleanRosterText(name);
   if(!id||!text)continue;
   if(!refs.has(id))refs.set(id,{name:'',source:'Not tablosu',sheets:new Set()});
   refs.get(id).sheets.add(text);
  }
 }
 return refs;
}
function rosterReviewState(list,index,id,refs){
 const [original,read]=list.entries[index],ref=refs.get(id);
 const known=ref?.name||(ref?.sheets.size===1?Array.from(ref.sheets)[0]:'');
 const candidates=Array.from(new Set([...(list.alternatives?.[original]||[]),...(ref?.sheets||[])]));
 const disagreement=candidates.some(n=>known&&n!==known)||(!known&&candidates.length>1);
 const needsReview=Boolean(list.alternatives?.[original]||list.scanned&&(
  list.uncertain?.includes(original)||!known||known!==read||disagreement||original!==id));
 return {read,known:list.scanned?known:'',source:ref?.source||'',candidates,needsReview};
}
function updateRosterReview(tr){
 const id=tr.querySelector('[data-id]').value.trim(),input=tr.querySelector('[data-name]');
 const {list,references}=rosterRequest;
 const state=rosterReviewState(list,Number(tr.dataset.record),id,references);
 input.readOnly=Boolean(state.known);
 const originalId=list.entries[Number(tr.dataset.record)][0];
 input.value=state.known||(tr.dataset.editedName??(list.alternatives?.[originalId]?'':state.read));
 const info=tr.querySelector('[data-source]');
 const details=[];
 if(state.known&&state.known!==state.read)details.push('Taramada okunan: '+(state.read||'—'),state.source+': '+state.known);
 else if(list.scanned&&state.known&&state.needsReview)details.push(state.source+' ile eşleşti.');
 else if(list.scanned&&!state.known&&!state.candidates.length)details.push('Bu numara için karşılaştırılacak bir ders kaydı yok.');
 if(state.candidates.length>1||state.known&&state.candidates.some(n=>n!==state.known))details.push('Kaynaklarda geçen adlar: '+state.candidates.join(' / '));
 info.textContent=details.join(' ');
 const checkbox=tr.querySelector('[data-confirm]');
 checkbox.closest('label').style.display=state.needsReview?'block':'none';
 checkbox.closest('label').hidden=!state.needsReview;
 checkbox.checked=false;
}
function mergeRoster(sheet,roster){
 if(sheet.anonymous)return;
 const existing=new Set(sheet.rows.map(r=>String(r[0]).trim()));
 const added=roster.filter(([id])=>!existing.has(id));
 if(!added.length)return;
 sheet.rows=sheet.rows.filter(r=>r.some(v=>String(v??'').trim()));
 for(const [id,name] of added)sheet.rows.push([id,name,...Array(sheet.questions.length+2).fill('')]);
}
async function acceptRoster(){
 const {list}=rosterRequest,v=$('rosterCourse').value,apply=$('rosterApply').checked;
 const elements=Array.from(document.querySelectorAll('#rosterReview tr[data-record]'));
 const rows=[];
 for(const tr of elements){
  const id=tr.querySelector('[data-id]').value.trim(),name=tr.querySelector('[data-name]').value.trim();
  const state=rosterReviewState(list,Number(tr.dataset.record),id,rosterRequest.references);
  const checkbox=tr.querySelector('[data-confirm]');
  if(state.needsReview&&!checkbox.checked){checkbox.focus();window.alert('İşaretli satırın numarasını ve adını kaynak dosyada kontrol edip onaylayın.');return}
  rows.push([id,state.known||name]);
 }
 const ids=new Set();for(const [id,name] of rows){if(!/^\d{5,20}$/.test(id)||!name||ids.has(id)){window.alert('Her öğrenci için geçerli, benzersiz bir numara ve ad-soyad girin.');return}ids.add(id)}
 list.entries=rows;
 if(v==='new'){const code=document.getElementById('scanCode')?.value.trim()||list.code,name=document.getElementById('scanName')?.value.trim()||list.name||code;course=fresh(name,code);courseList.push(course)}else course=courseList.find(c=>c.id===v);
 const roster=new Map(course.roster||[]);for(const [id,name] of list.entries)if(!roster.has(id))roster.set(id,name);
 course.roster=Array.from(roster);
 if(apply)for(const sheet of Object.values(course.sheets))mergeRoster(sheet,list.entries);
 localStorage.selectedCourse=course.id;opened=4;filter=0;await save();rosterRequest=null;
 grades();notify('Ders listesinde '+course.roster.length+' öğrenci var.');
}


function rosterPreview(list){
 const rows=list.entries.map(([id,name],index)=>{
  const options=list.alternatives?.[id],key='rosterNames'+id;
  const candidates=options?'<datalist id="'+key+'">'+options.map(n=>'<option value="'+esc(n)+'"></option>').join('')+'</datalist><small>Kaynakta geçen adlar: '+options.map(esc).join(' / ')+'</small>':'';
  const hint=options?' list="'+key+'" placeholder="Doğru adı seçin veya yazın"':(!name?' placeholder="Okunamayan adı yazın"':'');
  return '<tr data-record="'+index+'"><td><input data-id aria-label="Öğrenci numarası" value="'+esc(id)+'"></td><td><input data-name aria-label="Adı soyadı" value="'+esc(options?'':name)+'"'+hint+'>'+candidates+'<small data-source></small><label hidden><input data-confirm type="checkbox"> Numarayı ve adı kontrol ettim</label></td></tr>';
 }).join('');
 return (list.scanned?'<p>Taramadan okunan numara ve adları kontrol edin.</p>':'')+'<div class="scroll" id="rosterReview"><table><thead><tr><th>Öğrenci No</th><th>Adı Soyadı</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

