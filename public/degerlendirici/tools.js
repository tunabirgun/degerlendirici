const baseScale=[['AA',90],['BA',82],['BB',74],['CB',68],['CC',62],['DC',56],['DD',50],['FF',0]];
const norm=s=>String(s??'').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').trim();
const official='https://cmspanel.yeniyuzyil.edu.tr/uploaded/files/iYYu-on-Lisans-ve-Lisans-Egitim-ogretim-ve-Sinav-Yonetmeligi.pdf?v=829';
function matrix(w,n){
 const options={header:1,defval:'',blankrows:false},sheet=w.Sheets[n];
 const rows=XLSX.utils.sheet_to_json(sheet,options);
 const isId=v=>/ogrenci.*(no|numara)|^numara$|^student id$/.test(norm(v));
 const header=rows.find(row=>row.some(isId));
 if(!header)return rows;
 const id=header.findIndex(isId);
 if(rows.some(row=>typeof row[id]==='number')){
  const display=XLSX.utils.sheet_to_json(sheet,{...options,raw:false});
  rows.forEach((row,i)=>{
   if(typeof row[id]==='number'&&/^0\d+$/.test(display[i]?.[id]))row[id]=display[i][id];
  });
 }
 return rows;
}
async function readBook(f){if(typeof XLSX==='undefined')await loadLibrary('XLSX');return /\.csv$/i.test(f.name)?XLSX.read(await f.text(),{type:'string',raw:true}):XLSX.read(await f.arrayBuffer(),{type:'array'})}
function previewTable(rows){return '<div class="scroll"><table>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</table></div>'}
const isQuestionHeader=v=>/soru|^s\d+$/.test(norm(v));
const isOutcomeMap=v=>/^o(?:c)?\s*\d/.test(norm(v));
function anonymousSheet(rows){
 const ordinal=v=>/^(?:#|ogrenci\s*#|sira\s*(?:no(?:su)?|numarasi|#))$/.test(norm(v));
 const start=rows.findIndex(r=>ordinal(r[0]));
 if(start<0)return null;
 const questionHeader=rows.slice(0,start+1).findLastIndex(r=>r.slice(1).some(isQuestionHeader));
 if(questionHeader<0)return null;
 const header=rows[questionHeader],columns=header.flatMap((v,j)=>j>0&&isQuestionHeader(v)?[j]:[]);
 const intervening=rows.slice(questionHeader+1,start);
 const mapping=intervening.find(r=>norm(r[0]).startsWith('ogrenme cikti'))||(
   start===questionHeader&&rows[start+1]?.[0]===''?rows[start+1]:[]);
 const maxima=intervening.find(r=>norm(r[0])==='soru puani')||[];
 const clean=v=>String(v??'').trim();
 const maps=columns.map(j=>clean(mapping[j]));
 return {
  anonymous:true,ordinalLabel:clean(rows[start][0]),grouped:false,questions:columns.map(j=>clean(header[j])),
  maps,maximums:columns.map(j=>maxima[j]??''),
  rows:rows.slice(start+1).filter(r=>/^\d+$/.test(clean(r[0])))
   .map(r=>importRowAttendance([clean(r[0]),'',...columns.map(j=>r[j]??''),'',''],r,header))
 };
}
function sheetFrom(rows){
 const index=rows.findIndex(r=>r.some(v=>/ogrenci.*(no|numara)|^numara$|^student id$/.test(norm(v))));
 if(index<0)return anonymousSheet(rows);
 const header=rows[index],id=header.findIndex(v=>/ogrenci.*(no|numara)|^numara$|^student id$/.test(norm(v))),columns=studentNameColumns(header);
 if(columns[0]<0)columns[0]=header.findIndex(v=>/ad.*soyad|isim/.test(norm(v)));
 const next=rows[index+1]||[],map=String(next[id]??'').trim()?[]:next;
 const qs=header.flatMap((v,k)=>isQuestionHeader(v)||(!v&&isOutcomeMap(map[k]))?[k]:[]),g=header.findIndex(v=>norm(v).includes('harf')),p=header.findIndex(v=>/ham not|basari (puani|notu)|donem sonu puan/.test(norm(v)));
 if(!qs.length&&g<0&&p<0)return null;
 const mapped=qs.some(k=>isOutcomeMap(map[k])||/öç/i.test(map[k]));
 let lastHeader="";return {grouped:qs.some(k=>!header[k]),questions:qs.map(k=>lastHeader=String(header[k]||lastHeader)),maps:qs.map(k=>mapped?String(map[k]||'').trim().replace(/^[ÖO][ÇC]?\s*(\d+)$/i,(_,n)=>'ÖÇ '+n):''),rows:rows.slice(index+1+(mapped?1:0)).filter(r=>String(r[id]??'').trim()&&!/ortalama|toplam/.test(norm(r[id]))).map(r=>importRowAttendance([String(r[id]),studentName(r,columns),...qs.map(k=>r[k]),r[p]??'',r[g]??''],r,header))};
}
function isAbsentMark(value){return /^(g|gr|girmedi|katilmadi)$/.test(norm(value))}
function importRowAttendance(row,source,header){
 const col=header.findIndex(v=>/^(katilim|sinava katilim|katilim durumu)$/.test(norm(v)));
 if(col>=0&&isAbsentMark(source[col]))row.absent=true;
 return row;
}
function rowAbsent(sheet,row){
 return row.absent===true||row.slice(2,2+sheet.questions.length).some(isAbsentMark);
}
function setRowAbsent(sheet,row,absent){
 if(absent){row.absent=true;return}
 delete row.absent;
 for(let i=2;i<2+sheet.questions.length;i++)if(isAbsentMark(row[i]))row[i]='';
}
function examAverages(sheet){
 const questions=sheet.questions.map(()=>({count:0,sum:0,mean:null})),total={count:0,sum:0,mean:null};
 let participants=0;
 for(const row of sheet.rows){
  if(!String(row[0]??'').trim()||rowAbsent(sheet,row))continue;
  participants++;
  let complete=questions.length>0,points=0;
  questions.forEach((q,i)=>{
   const score=validQuestionScore(row[i+2],sheet.maximums?.[i]);
   if(score===null){complete=false;return}
   q.sum+=score;q.count++;points+=score;
  });
  if(complete){total.sum+=points;total.count++}
 }
 for(const entry of [...questions,total])if(entry.count)entry.mean=entry.sum/entry.count;
 return {questions,total,participants};
}
let activeSheet='';
async function importBook(file,parsedWorkbook){
 const owner=course;
 dialog('Not tablosunu içe aktar','<p id="gradeRead" role="status">Puan tablosu okunuyor…</p>');
 const reading=$('gradeRead'),active=()=>course===owner&&modal.open&&reading.isConnected;
 const pending=Object.create(null);
 try{
  const workbook=parsedWorkbook||await readBook(file);
  const knownNames=new Map(owner.roster||[]);
  if(!active())return;
  for(const tab of workbook.SheetNames){
   const sheet=sheetFrom(matrix(workbook,tab));
   if(!sheet)continue;
   sheet.sourceFormat=/\.xlsx$/i.test(file.name)?'xlsx':/\.xls$/i.test(file.name)?'xls':'';
   if(!sheet.anonymous)for(const row of sheet.rows){
    if(!row[1]&&knownNames.has(row[0]))row[1]=knownNames.get(row[0]);
   }
   const csv=/\.csv$/i.test(file.name);
   const title=csv?file.name.slice(0,-4).replace(/[\\/:?*\[\]]/g,' ').trim().slice(0,31)||tab:tab;
   let key=title;
   for(let i=2;Object.hasOwn(owner.sheets,key)||Object.hasOwn(pending,key);i++)key=title.slice(0,24)+' ('+i+')';
   pending[key]=sheet;
  }
 }catch{
  if(active())dialog('Puan tablosu okunamadı','<p>Dosyanız bölümde saklandı. Geçerli bir XLS, XLSX veya UTF-8 CSV dosyası seçin.</p>'+btn('Not tablosunu aç','grades()'));
  return;
 }
 const tabs=Object.keys(pending);
 if(!tabs.length){
  dialog('Not tablosunu içe aktar','<p>Öğrenci No ile birlikte Soru, Ham Not veya Harf Notu başlığı bulunamadı. Dosyanız bölümde saklandı. Düzenlenebilir bir şablon için not tablosunu kullanabilirsiniz.</p>'+btn('Not tablosunu aç','grades()'));
  return;
 }
 const summary=tabs.map(tab=>esc(tab)+' · '+pending[tab].rows.length+(pending[tab].anonymous?' anonim satır':' öğrenci')).join('<br>');
 const anonymousNotice=tabs.some(tab=>pending[tab].anonymous)?'<p>Anonim satırlarda yalnızca soru istatistikleri hesaplanır. Sıra numaraları bu sınavın içindeki kayıtları gösterir.</p>':'';
 dialog('Not tablosunu içe aktar','<p>'+summary+'</p>'+anonymousNotice+'<button id="acceptImportedGrades">'+icon('check')+'Tabloları ekle</button>');
 const accept=$('acceptImportedGrades');
 accept.onclick=async()=>{
  if(course!==owner||!modal.open||accept.disabled)return;
  accept.disabled=true;
  const previous=owner.sheets,done=owner.done[4];
  owner.sheets={...previous,...pending};owner.done[4]=false;
  try{await save()}
  catch(error){owner.sheets=previous;owner.done[4]=done;accept.disabled=false;throw error}
  if(course!==owner||!modal.open||!accept.isConnected)return;
  activeSheet=tabs[0];grades();
 };
}
const names=()=>Object.keys(course.sheets);
function headers(s){return [s.anonymous?'Sıra No':'Öğrenci No',s.anonymous?'':'Ad Soyad',...s.questions,'Ham Not','Harf Notu']}
function defaultExamInclusion(name){return !/mazeret|butunleme/.test(norm(name))}
function included(n){return course.sheets[n].include??defaultExamInclusion(n)}
async function addStudent(){
 await collectGrades();
 const sheet=course.sheets[activeSheet],row=Array(headers(sheet).length).fill('');
 if(sheet.anonymous){
  const highest=sheet.rows.reduce((max,r)=>/^\d+$/.test(String(r[0]))?Math.max(max,Number(r[0])):max,0);
  row[0]=String(highest+1);
 }
 sheet.rows.push(row);
 await persist();grades();focusGrade(sheet.rows.length-1,sheet.anonymous?2:0);
}
function newSheet(){
 const suggestions=['Vize','Final','Mazeret','Bütünleme','Kısa Sınav','Proje','Dönem sonu'];
 const name=suggestions.find(v=>!names().some(n=>norm(n)===norm(v)))||'';
 dialog('Sınav tanımla','<form id="newSheet"><div class="fieldpair"><label>Sınav veya faaliyet adı<input name="name" required list="examnames" maxlength="31" value="'+esc(name)+'"></label><label>Soru sayısı<input name="num" type="number" min="0" max="100" value="1" required></label></div><datalist id="examnames">'+suggestions.map(n=>'<option value="'+n+'">').join('')+'</datalist><label><input type="checkbox" name="include" '+(defaultExamInclusion(name)?'checked':'')+'> Rapor istatistiklerine kat</label><button class="primary" type="submit">Oluştur</button></form>');
 const form=$('newSheet'),field=form.elements.namedItem('name'),flag=form.elements.namedItem('include');
 let inclusionChosen=false;
 flag.onchange=()=>{inclusionChosen=true};
 field.oninput=()=>{if(!inclusionChosen)flag.checked=defaultExamInclusion(field.value)};
 form.onsubmit=async event=>{
  event.preventDefault();
  const exam=field.value.trim(),count=Number(form.elements.namedItem('num').value);
  if(!exam||exam in course.sheets||names().some(n=>norm(n)===norm(exam))||/[\\/?*\[\]:]/.test(exam)||/^'|'$/.test(exam)){
   field.setCustomValidity('Benzersiz ve Excel sayfalarında kullanılabilen bir ad girin.');
   field.reportValidity();
   field.setCustomValidity('');
   return;
  }
  if(!Number.isInteger(count)||count<0||count>100)return;
  const sheet={questions:Array.from({length:count},(_,i)=>(i+1)+'. Soru'),maps:Array(count).fill(''),maximums:Array(count).fill(''),include:flag.checked,rows:[Array(count+4).fill('')]};
  if(course.roster?.length)mergeRoster(sheet,course.roster);
  course.sheets[exam]=sheet;course.done[4]=false;
  activeSheet=exam;gradeSearch='';gradeMode='scores';
  await save();grades();showExamSettings();
 };
}
function dataRows(s){
 const withAttendance=s.rows.some(r=>rowAbsent(s,r));
 const head=s.anonymous?['Sıra No',...s.questions]:headers(s);
 if(withAttendance)head.push('Katılım');
 const map=s.anonymous?['',...s.maps]:['','',...s.maps];
 const records=s.rows.filter(r=>s.anonymous?String(r[0]??'').trim():r.some(v=>String(v??'').trim())).map(r=>{
  const cells=s.anonymous?[r[0],...r.slice(2,2+s.questions.length)]:r.slice();
  if(withAttendance)cells.push(rowAbsent(s,r)?'G':'');
  return cells;
 });
 return [head,...(s.maps.some(Boolean)?[map]:[]),...records];
}
function numeric(v){if(v==null||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null}
function scale(){return course.scale||baseScale}
function letterOf(raw,letter,tolerance=0){
 const explicit=String(letter||'').trim().toUpperCase();
 if(explicit)return explicit;
 const score=numeric(raw);
 if(score===null||score<0||score-100>tolerance)return null;
 return scale().find(([,min])=>min-score<=tolerance)?.[0];
}
function dist(){const obs=typeof confirmedObsDistribution==='function'&&confirmedObsDistribution();if(obs)return obs;const scores=new Map();let conflicts=new Set();for(const n of names().filter(included)){if(course.sheets[n].anonymous)continue;for(const r of course.sheets[n].rows){if(rowAbsent(course.sheets[n],r))continue;const id=String(r[0]??'').trim(),k=letterOf(r.at(-2),r.at(-1));if(!id||!k)continue;if(scores.has(id)&&scores.get(id)!==k)conflicts.add(id);scores.set(id,k)}}for(const [id,k] of weightedLetters())if(!scores.has(id)&&k)scores.set(id,k);for(const id of conflicts)scores.delete(id);const counts=new Map(scale().map(([l])=>[l,0]));for(const k of scores.values())counts.set(k,(counts.get(k)||0)+1);return {counts,conflicts:conflicts.size,total:scores.size}}
function chart(){const {counts,total,conflicts}=dist();let max=Math.max(1,...counts.values());return '<h3>Harf notu dağılımı</h3><p>'+total+' öğrenci'+(conflicts?' · Çelişen dönem sonu notu bulunan '+conflicts+' öğrenci hesap dışında.':'')+'</p>'+(total?Array.from(counts,([k,n])=>'<div style="display:flex;gap:9px;align-items:center;margin:5px 0"><b style="width:34px">'+esc(k)+'</b><span style="width:65%;background:#eee;height:14px"><span style="display:block;background:#535c66;height:14px;width:'+100*n/max+'%"></span></span>'+n+'</div>').join(''):'<p>Dağılım için öğrenci numarasıyla birlikte dönem sonu ham notunu veya OBS harf notunu girin.</p>')}
function statsView(){const sources=course.files[3].flatMap((f,j)=>/\.pdf$/i.test(f.name)?[btn(esc(f.name)+' · Harfleri oku','reviewObsLetters(course.files[3]['+j+'])','scan-text')]:[]);dialog('Harf notları ve istatistikler',(confirmedObsDistribution()?'<p>Dağılım için onaylanmış OBS harf notları kullanılıyor.</p>':'')+(sources.length?'<div class="stats-sources">'+sources.join('')+'</div>':'')+chartPair()+'<div class="actions">'+btn('Baremi düzenle','scaleView()','sliders-horizontal')+btn('Not tablosu','grades()','sheet')+btn('Sütun grafiği indir',"nativeDownload('bars','Harf Notu Dağılımı - Sütun.png')",'download')+btn('Pasta grafiği indir',"nativeDownload('chart','3. Harf Notu Dağılımı.png')",'download')+'</div>')}
function scaleView(){dialog('Harf notu baremi','<p>Varsayılan eşikler İstanbul Yeni Yüzyıl Üniversitesi ön lisans ve lisans yönetmeliğinin 18. maddesinden alınmıştır. Diş Hekimliği, Hukuk ve Tıp için ilgili fakülte yönergesi uygulanır. <a target="_blank" rel="noopener" href="'+official+'">Resmî yönetmelik</a></p><label>Harf ve alt puan sınırı (her satırda bir çift)<textarea id="scale">'+esc(scale().map(v=>v.join(' ')).join('\n'))+'</textarea></label><p>DZ, OBS’den gelen devamsızlık işareti olarak sayılır. Sayısal puanlara alt eşik doğrudan uygulanır.</p><div class="actions">'+btn('Kaydet','saveScale()','check')+btn('Varsayılanı getir','resetScale()')+'</div><p id="scaleError" role="alert"></p>')}
function resetScale(){$('scale').value=baseScale.map(v=>v.join(' ')).join('\n')}
async function saveScale(){let a=$('scale').value.trim().split(/\n/).map(l=>l.trim().split(/\s+/));if(a.some(v=>v.length!==2||!/^\p{L}{1,5}$/u.test(v[0])||v[0].toUpperCase()==='DZ'||numeric(v[1])===null)||a.some((v,i)=>numeric(v[1])<0||numeric(v[1])>100||i&&numeric(v[1])>=numeric(a[i-1][1]))||numeric(a.at(-1)[1])!==0||new Set(a.map(v=>v[0].toUpperCase())).size!==a.length){$('scaleError').textContent='Her satıra benzersiz bir harf ve azalan bir alt sınır girin. Son eşik 0 olmalıdır.';return}course.scale=a.map(([k,n])=>[k.toUpperCase(),numeric(n)]);await save();statsView()}
function examStats(){
 const exams=names().filter(name=>included(name)&&course.sheets[name].questions.length);
 if(!exams.length)return '<p>Rapor istatistiklerine dahil edilmiş, soru bazında puanlanan bir sınav yok.</p>';
 const format=value=>value==null?'—':value.toLocaleString('tr-TR',{maximumFractionDigits:2});
 const tables=exams.map((name,index)=>{
  const sheet=course.sheets[name],stats=examAverages(sheet);
  const limits=sheet.questions.map((_,i)=>numeric(sheet.maximums?.[i]));
  const maxTotal=limits.every(v=>v!==null&&v>0)?limits.reduce((sum,v)=>sum+v,0):null;
  const rows=sheet.questions.map((q,i)=>{
   const mapping=String(sheet.maps?.[i]??'').trim();
   return '<tr><th scope="row">'+esc(q)+'</th><td>'+esc(mapping||'Eşleştirilmedi')+'</td><td>'+format(stats.questions[i].mean)+'</td><td>'+format(limits[i])+'</td><td>'+stats.questions[i].count+'</td></tr>';
  }).join('');
  return '<details'+(index===0?' open':'')+'><summary>'+esc(name)+' · Sınav ortalaması '+format(stats.total.mean)+' / '+format(maxTotal)+'</summary>'+
   '<table class="evidence-table"><thead><tr><th>Soru</th><th>Öğrenme çıktısı</th><th>Ortalama puan</th><th>Tam puan</th><th>Öğrenci sayısı</th></tr></thead><tbody>'+rows+
   '</tbody><tfoot><tr><th scope="row" colspan="2">Sınav toplamı</th><td>'+format(stats.total.mean)+'</td><td>'+format(maxTotal)+'</td><td>'+stats.total.count+'</td></tr></tfoot></table></details>';
 });
 return tables.join('')+'<p class="sub">Soru ortalamasına o soruda geçerli puanı bulunanlar, sınav ortalamasına tüm soruları puanlanmış olanlar girer. Sınava katılmayan öğrenciler her iki hesabın dışındadır. Çizgi, veri girilmediğini gösterir.</p>';
}
function mainOutcomes(text){
 const block=text.split(/[öo][ğg]ren[mn]e\s+[çc][ıi]kt[ıi]lar[ıi](?:\s+ve\s+alt\s+beceriler)?\s*[:：]?/i)[1]||'';
 const lines=block.split(/(?:^|\n)\s*[|¦]?\s*ders(?:in)?\s+k[ıi]sa\s+tan[ıi]m[ıi]\s*[:.]|öğretim\s+yöntem|ön\s*koşul|değerlendirme\s+yöntemi|temel\s+kaynak|haftalık\s+(?:ders|plan)/i)[0].split(/\r?\n/);
 const result=[];let active=false;let previous=0;
 // A subpoint and its wrapped lines belong together until the next main number.
 const subpoint=/^(?:(?:[öo][çc]\s*)?\d+\s*(?:[.-](?:\s*[a-zçğıöşü][.)]|[a-zçğıöşü]\s|\s*\d+)|\([a-zçğıöşü]\))|\([a-zçğıöşü]\)|[a-zçğıöşü][.)])/iu;
 for(let line of lines){line=line.replace(/^[\s|¦]+/g,"").trim().replace(/^(\d{1,2})[$|¦]+(?=[.)])/,'$1');if(!line)continue;
 // Vertical borders are sometimes read as an isolated dotted I or quotation mark.
 line=line.replace(/^[İI'’&]\s*(?=(?:\d{1,2}|[a-zçğıöşü])[.)])/u,'')
          .replace(/^[&'’]\s*(?=[abç]\s{2,})/u,'');
 if(previous===4)line=line.replace(/^\$[.)]\s*[“"]?\s*/, '5. ');
 if(/^[abç]\s{2,}\p{Lu}/u.test(line)){active=false;continue}
 if(subpoint.test(line)){active=false;continue}
 let m=line.match(/^(?:ÖÇ\s*)?(\d{1,2})\s*[.)\-:–]\s*(.+)/i)||line.match(/^ÖÇ\s*(\d{1,2})\s+(.+)/i);
 if(m){previous=Number(m[1]);result.push('ÖÇ '+m[1]+' — '+m[2]);active=true}else if(active){result[result.length-1]+=' '+line}}
 return result.join('\n')
}
async function extractText(f,progress){
 if(/\.txt$/i.test(f.name))return f.text();
 if(/\.docx$/i.test(f.name)){
   const zip=await JSZip.loadAsync(await f.arrayBuffer());
   const xml=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
   const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const elements=(node,tag)=>Array.from(node?.getElementsByTagNameNS(ns,tag)||[]);
   const value=(node,tag)=>elements(node,tag)[0]?.getAttributeNS(ns,'val');
   const line=p=>elements(p,'t').map(t=>t.textContent).join('');
   const paragraphs=node=>elements(node,'p').map(line);
   // Word stores automatic list labels separately from the paragraph text.
   const numbering=zip.file('word/numbering.xml');
   const lists=numbering?new DOMParser().parseFromString(await numbering.async('string'),'application/xml'):null;
   const definitions=new Map(elements(lists,'abstractNum').map(n=>[n.getAttributeNS(ns,'abstractNumId'),n]));
   const counters=new Map();
   const instances=new Map(elements(lists,'num').map(n=>[n.getAttributeNS(ns,'numId'),n]));
   const body=elements(xml,'p').map(p=>{
     const text=line(p),props=elements(p,'numPr')[0],id=value(props,'numId'),level=value(props,'ilvl')||'0';
     if(!text.trim()||!id)return text;
     const instance=instances.get(id),def=definitions.get(value(instance,'abstractNumId'));
     const definition=elements(def,'lvl').find(el=>el.getAttributeNS(ns,'ilvl')===level);
     if(!definition)return text;
     const key=id+'-'+level,override=elements(instance,'lvlOverride').find(el=>el.getAttributeNS(ns,'ilvl')===level);
     const next=counters.get(key)??Number(value(override,'startOverride')||value(definition,'start')||1);
     counters.set(key,next+1);
     if(/^(?:ÖÇ\s*)?\d+[.)]\s|^[a-z][.)]\s/iu.test(text))return text;
     return (level==='0'&&value(definition,'numFmt')==='decimal'?next+'. ':'a. ')+text;
   }).join('\n');
   const header=xml.getElementsByTagNameNS(ns,'tbl')[0];
   if(header){
     for(const row of Array.from(header.getElementsByTagNameNS(ns,'tr')).slice(0,3)){
       const cells=Array.from(row.children).filter(c=>c.localName==='tc').map(c=>paragraphs(c).join(' ').trim());
       const codeIndex=cells.findIndex(s=>/^[A-ZÇĞİÖŞÜ]{2,6}\s*\d{3,4}(?:\s*\(.*\))?$/u.test(s));
       const name=cells.length===2?cells[1-codeIndex]:'';
       if(codeIndex>=0&&name&&/\p{L}/u.test(name)&&name.length<=150&&!/^(?:ders(?:in)?\s+(?:adı|kodu)|course\s+(?:name|code))\s*:?$/iu.test(name)){
         return 'Dersin adı: '+name+'\nDers kodu: '+cells[codeIndex]+'\n'+body;
       }
     }
   }
   return body;
 }
 let worker,pdf;async function ocr(input){if(typeof Tesseract==='undefined')await loadLibrary('Tesseract');if(!worker)worker=await Tesseract.createWorker('tur',1,{workerPath:new URL('worker.min.js',document.baseURI).href,corePath:new URL('tesseract-core-lstm.wasm.js',document.baseURI).href,langPath:new URL('.',document.baseURI).href,workerBlobURL:false});return (await worker.recognize(input)).data.text}
 async function readScan(canvas,firstPage){
   const body=await ocr(canvas);
   return firstPage ? (await ocrHeading(canvas,worker,body))+body : body;
 }
 try{
   if(!/\.pdf$/i.test(f.name)){
     const image=await createImageBitmap(f);
     const canvas=document.createElement('canvas');
     try{
       const scale=Math.min(2,1450/Math.min(image.width,image.height),3000/Math.max(image.width,image.height));
       canvas.width=Math.max(1,Math.round(image.width*scale));
       canvas.height=Math.max(1,Math.round(image.height*scale));
       const ctx=canvas.getContext('2d');
       ctx.fillStyle='white';
       ctx.fillRect(0,0,canvas.width,canvas.height);
       ctx.drawImage(image,0,0,canvas.width,canvas.height);
       return await readScan(canvas,true);
     }finally{image.close();canvas.width=0}
   }
   if(typeof pdfjsLib==='undefined')await loadLibrary('pdfjsLib');
   pdfjsLib.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';
   pdf=await pdfjsLib.getDocument({data:await f.arrayBuffer(),useSystemFonts:true}).promise;
   const pages=[];
   for(let i=1;i<=pdf.numPages;i++){
     progress(i+' / '+pdf.numPages);
     const page=await pdf.getPage(i);
     try{
       const {items}=await page.getTextContent();
       let txt=items.map(it=>it.str+(it.hasEOL?'\n':' ')).join('');
       if(txt.trim().length<35){
         const viewport=page.getViewport({scale:2.3});
         const canvas=document.createElement('canvas');
         canvas.width=viewport.width;
         canvas.height=viewport.height;
         try{
           await page.render({viewport,canvasContext:canvas.getContext('2d')}).promise;
           txt=await readScan(canvas,i===1);
         }finally{canvas.width=0}
       }
       pages.push(txt);
     }finally{page.cleanup()}
   }
   return pages.join('\n');
 }finally{if(worker)await worker.terminate();if(pdf)await pdf.destroy()}
}
function syllabusFields(text){
 const lines=text.split(/\r?\n/).map(line=>line.replace(/[ \t]+/g,' ').trim());
 let header;
 for(let i=0;i<Math.min(35,lines.length-1);i++){
   if(!/\bAKTS\b|s\s*\/\s*hafta/iu.test(lines.slice(i+1,i+3).join(' ')))continue;
   const row=lines[i].match(/^[|¦ ]*([\p{L}][^|¦]{1,140}?)\s+[|¦ ]*([A-ZÇĞİÖŞÜ]{2,6}?)\s*([Iİl1-9\d](?:\s*[\dIİl]){2,3})[ |¦]*$/u);
   if(row&&/\d.*\d/.test(row[3])){
     header={name:row[1].trim(),code:row[2]+row[3].replace(/\s/g,'').replace(/[Iİl]/g,'1')};
     break;
   }
 }
 const code=text.match(/Ders(?:in)?\s+kodu\s*[:：]\s*([A-ZÇĞİÖŞÜ]{2,6}[ \t]*\d{3,4})/iu)?.[1]||header?.code||text.match(/(?:^|[^\p{L}\d])([A-ZÇĞİÖŞÜ]{2,6}[ \t]*\d{3,4})(?!\d)/u)?.[1];
 // Scanned tables often put the course title and code on one line above the credits.
 const tableName=text.match(/^[\s|¦]*([\p{L}][^\r\n]{2,100}?)[ \t]+[A-ZÇĞİÖŞÜ]{2,6}[ \t]*\d{3,4}[ \t|¦]*\r?\n[^\r\n]*\bAKTS\b/mu)?.[1];
 const name=(text.match(/Ders(?:in)?\s+adı\s*[:：][ \t]*([^\n]+)/iu)?.[1]||tableName)?.trim();
 const term=parseTerm(text.replace(/\b(2[ \t]*0[ \t]*\d[ \t]*\d)[ \t]*[–—-][ \t]*(2[ \t]*0[ \t]*\d[ \t]*\d)\b/g,m=>m.replace(/[ \t]/g,'')));
 if(term.year){const [start,end]=term.year.split('–').map(Number);if(end!==start+1)term.year=''}
 const teacher=text.match(/(?:Prof\.|Doç\.|Dr\.|Öğr\. Gör\.|Arş\. Gör\.)[ \t]+[^\n@]{3,75}/iu)?.[0];
 return {code:code?.replace(/\s/g,''),name:name?.replace(/[ \t]+/g,' ')||header?.name,...term,...parseTeacher(teacher),outcomes:mainOutcomes(text)};
}
const syllabusTextCache=new WeakMap();
async function readSyllabus(){
 const owner=course,file=course.files[1].at(-1);
 if(!file){pick(1);return}
 dialog('İzlence okunuyor','<p id="reading">Belge cihazınızda işleniyor…</p>');
 const reading=$('reading');
 try{
   const text=syllabusTextCache.get(file)??await extractText(file,page=>{if(reading.isConnected)reading.textContent='Sayfa '+page+' okunuyor…'});
   if(text.trim())syllabusTextCache.set(file,text);
   if(course!==owner||!reading.isConnected||!modal.open)return;
   const fields=syllabusFields(text);
   const existing={...parseTerm(owner.term),...parseTeacher(owner.teacher),...owner};
   const suggested={...existing,...Object.fromEntries(Object.entries(fields).filter(([,value])=>value))};
   const differences=[];
   for(const [key,label] of [['code','Ders kodu'],['name','Ders adı'],['year','Akademik yıl'],['season','Dönem']]){
    if(!existing[key]||!fields[key]||norm(existing[key])===norm(fields[key]))continue;
    suggested[key]=existing[key];
    differences.push('<li>'+label+' · kayıt: '+esc(existing[key])+' · izlence: '+esc(fields[key])+'</li>');
   }
   const warning=differences.length?'<aside class="grade-note"><strong>İzlenceyle ders kaydı arasında fark var.</strong><ul>'+differences.join('')+'</ul>Kayıtlı değerler seçili. Gerekirse aşağıdan değiştirebilirsiniz.</aside>':'';
   dialog('İzlenceden okunan bilgiler','<p>Önerileri kontrol edip ders kaydına aktarın.</p>'+warning+'<form id="ocrForm">'+courseFields(suggested)+'<h3>Ana öğrenme çıktıları</h3>'+outcomeEditor(fields.outcomes?parseOutcomeList(fields.outcomes):currentOutcomes())+'<details><summary>Okunan metni göster</summary><pre style="white-space:pre-wrap">'+esc(text)+'</pre></details><button class="primary">Bilgileri aktar</button></form>');
   $('ocrForm').oninput=clearOutcomeError;
   $('ocrForm').onsubmit=async e=>{e.preventDefault();const edit=readOutcomeRows();if(!edit)return;storeCourseFields(e.target);storeOutcomes(edit);await save();modal.close()};
 }catch(error){if(course!==owner||!reading.isConnected||!modal.open)return;console.error('İzlence okuma hatası',error);dialog('İzlence okunamadı','<p>Orijinal belge pakette saklandı. Ders bilgilerini ve ana çıktıları elle girebilirsiniz.</p>'+btn('Ders bilgileri','courseForm(false)')+btn('Öğrenme çıktıları','outcomes()'))}
}
