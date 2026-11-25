// OBS dönem sonu listesinin çizgili tablosunda HBN, başarı notu ve sonuç yan yanadır.
function obsTableLines(canvas,narrow=false) {
 const {width:w,height:h}=canvas;
 const left=Math.round(w*.54),width=Math.round(w*.06);
 const rgba=canvas.getContext('2d').getImageData(left,0,width,h).data;
 const lines=[];
 for(let y=0;y<h;y++){
  let dark=0;
  for(let x=0;x<width;x+=2)if(rgba[4*(y*width+x)]<195)dark++;
  if(dark<width*.31)continue;
  const prev=lines.at(-1);
  if(prev&&y-prev.end<3)prev.end=y;else lines.push({start:y,end:y});
 }
 const centers=lines.map(v=>Math.round((v.start+v.end)/2));
 const gaps=centers.slice(1).map((y,i)=>y-centers[i]).filter(d=>d>h*.005&&d<h*.017).sort((a,b)=>a-b);
 if(!gaps.length)return [];
 const pitch=gaps[Math.floor(gaps.length/2)];
 let best=[];
 for(const first of centers){
  const group=[first];
  for(const line of centers){
   const delta=line-group.at(-1);
   if(delta<pitch*.77)continue;
   if(delta>pitch*1.27)break;
   group.push(line);
  }
  if(group.length>best.length)best=group;
 }
 // Correct the slight slope between the blank middle column and the grade column.
 const band=canvas.getContext('2d').getImageData(Math.round(w*.88),0,width,h).data;
 const strength=y=>{
  let sum=0;
  for(let x=0;x<width;x+=2){
   const ink=Math.max(0,200-band[4*(y*width+x)]);
   sum+=narrow?ink:Number(ink>0);
  }
  return sum;
 };
 return best.map(y=>{
  let peak=y;
  const tolerance=narrow?Math.round(pitch*.17):Math.round(pitch*.45);
  for(let j=Math.max(1,y-tolerance);j<=Math.min(h-1,y+tolerance);j++)if(strength(j)>strength(peak))peak=j;
  return peak;
 });
}
function obsCell(canvas,x,y,w,h) {
 const cell=document.createElement('canvas');
 cell.width=w;cell.height=h;
 cell.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);
 return cell;
}
function obsGlyph(crop){
 const {width:w,height:h}=crop,ctx=crop.getContext('2d');
 const p=ctx.getImageData(0,0,w,h).data;
 const cols=Array(w).fill(0);
 for(let y=2;y<h-2;y++)for(let x=0;x<w;x++)if(p[4*(y*w+x)]<110)cols[x]++;
 const first=cols.findIndex(n=>n>=2);if(first<0)return null;
 let last=first;
 for(let x=first+1;x<w&&x-last<=Math.max(4,h*.26);x++)if(cols[x]>=2)last=x;
 let top=h,bottom=0;
 for(let y=2;y<h-2;y++)for(let x=first;x<=last;x++)if(p[4*(y*w+x)]<110){top=Math.min(top,y);bottom=Math.max(bottom,y)}
 if(last-first<4||bottom-top<3)return null;
 const tile=document.createElement('canvas');tile.width=24;tile.height=16;
 const tc=tile.getContext('2d');tc.drawImage(crop,first,top,last-first+1,bottom-top+1,0,0,24,16);
 return tc.getImageData(0,0,24,16).data.filter((_,index)=>index%4===0);
}
async function obsPageLetters(canvas,worker,valid,narrow=false) {
 const lines=obsTableLines(canvas,narrow);
 if(lines.length<4)return obsTextLetters(canvas,worker,valid);
 const w=canvas.width,pitch=lines[2]-lines[1];
 await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
 async function isHeader(top){
  for(const offset of [0,-4,4]){
   const head=obsCell(canvas,Math.floor(w*.7),Math.max(0,top+offset+2),Math.floor(w*.275),pitch-4);
   const text=norm((await worker.recognize(head)).data.text);
   if(/notu|sonu[cç]|hbn|final|vize/.test(text))return true;
  }
  return false;
 }
 const startsWithHeader=await isHeader(lines[0]);
 if(!startsWithHeader&&!await isHeader(lines[0]-pitch)){
  if(!narrow)return obsPageLetters(canvas,worker,valid,true);
  return obsTextLetters(canvas,worker,valid);
 }
 const rows=[];
 // The first ruled interval may be the header itself. It contains several words.
 for(let i=startsWithHeader?1:0;i<lines.length-1;i++){
  const y=lines[i]+2,h=lines[i+1]-y-2;
  if(h<4)continue;
  const crop=obsCell(canvas,Math.round(w*.878),y,Math.round(w*.047),h);
  const context=obsCell(canvas,Math.round(w*.72),y,Math.round(w*.247),h);
  rows.push({crop,image:context.toDataURL('image/png')});
 }
 const strip=document.createElement('canvas'),step=58,ctx=strip.getContext('2d');
 strip.width=250;strip.height=rows.length*step;ctx.fillStyle='white';ctx.fillRect(0,0,strip.width,strip.height);
 rows.forEach(({crop},i)=>{
  ctx.fillStyle='#111';ctx.font='26px Arial';ctx.fillText('NOT',7,i*step+39);
  ctx.drawImage(crop,80,i*step+8,crop.width*38/crop.height,38);
 });
 const words=(await worker.recognize(strip)).data.words;
 const result=rows.map((r,i)=>{
  const raw=words.filter(t=>t.bbox.x1>77&&Math.floor((t.bbox.y0+t.bbox.y1)/2/step)===i).map(t=>t.text).join('');
  const clean=raw.toUpperCase().replace(/^NOT\W*/,'').replace(/[^A-Z08Ö]/g,'').replace(/8/g,'B').replace(/0/g,'D');
  const letter=valid.includes(clean)?clean:valid.includes('DZ')&&/^[DÖO]+Z[DÖON]*$/.test(clean)?'DZ':'';
  return {letter,image:r.image,raw,glyph:obsGlyph(r.crop)};
 });
 return obsMatchGlyphs(result,42,7);
}
// The same printer repeats its glyphs on a page. Use only clearly separated matches.
function obsMatchGlyphs(result,ceiling,margin){
 const known=result.filter(r=>r.letter&&r.glyph);
 for(const r of result){
  if(r.letter||!r.glyph)continue;
  const scores=new Map();
  for(const ref of known){
   const diff=ref.glyph.reduce((sum,v,i)=>sum+Math.abs(v-r.glyph[i]),0)/ref.glyph.length;
   scores.set(ref.letter,Math.min(scores.get(ref.letter)??Infinity,diff));
  }
  const sorted=[...scores].sort((a,b)=>a[1]-b[1]);
  if(sorted.length>1&&sorted[0][1]<ceiling&&sorted[1][1]-sorted[0][1]>margin)r.letter=sorted[0][0];
 }
 return result;
}
// Older OBS printouts may have very faint ruling and different margins.
// Anchor the grade column on its printed heading and the row on its result.
async function obsTextLetters(canvas,worker,valid){
 const w=canvas.width,left=Math.floor(w*.7),right=obsCell(canvas,left,0,w-left,canvas.height);
 await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
 const {words}=(await worker.recognize(right)).data;
 const heading=words.find(t=>/^b\W*notu$/i.test(t.text));
 const outcome=words.find(t=>/^sonuc$/.test(norm(t.text))&&heading&&Math.abs(t.bbox.y0-heading.bbox.y0)<30);
 if(!heading||!outcome)throw new Error('OBS başarı notu ve sonuç sütunları doğrulanamadı.');
 const middle=t=>(t.bbox.y0+t.bbox.y1)/2;
 const status=words.filter(t=>t.bbox.y0>heading.bbox.y1&&Math.abs(t.bbox.x0-outcome.bbox.x0)<outcome.bbox.x1-outcome.bbox.x0&&/^(gecti|kaldi)[.,]?$/i.test(norm(t.text))).sort((a,b)=>middle(a)-middle(b));
 if(status.length<2)throw new Error('OBS sonuç satırları ayırt edilemedi.');
 const gaps=status.slice(1).map((t,i)=>middle(t)-middle(status[i])).sort((a,b)=>a-b);
 const pitch=gaps[Math.floor(gaps.length/2)];
 if(pitch<6||pitch>canvas.height*.04)throw new Error('OBS satır aralığı doğrulanamadı.');
 const centers=[];
 for(const t of status){
  if(centers.length){
   const prev=centers.at(-1),n=Math.round((middle(t)-prev)/pitch);
   if(n<1||n>4||Math.abs((middle(t)-prev)-n*pitch)>pitch*.45)throw new Error('OBS satır sırası doğrulanamadı.');
   for(let j=1;j<n;j++)centers.push(prev+j*pitch);
  }
  centers.push(middle(t));
 }
 const rows=centers.map(y=>{
  const tokens=words.filter(t=>Math.abs(middle(t)-y)<pitch*.43&&t.bbox.x0>=heading.bbox.x0-pitch*.6&&t.bbox.x1<outcome.bbox.x0-pitch*.25);
  const raw=tokens.map(t=>t.text).join('').trim();
  const code=raw.toLocaleUpperCase('tr').replace(/[^A-Z]/g,'');
  const y0=Math.max(0,Math.round(y-pitch*.46)),h=Math.max(1,Math.floor(pitch*.92));
  const crop=obsCell(canvas,left+Math.round(heading.bbox.x0-pitch*.55),y0,Math.round(outcome.bbox.x0-heading.bbox.x0-pitch*.25),h);
  const absenceMark=/^DZ(?:[BD]?D)?\.$/.test(raw.toUpperCase().replace(/[:.](?=.)/g,''));
  const failed=status.some(t=>Math.abs(middle(t)-y)<pitch*.4&&/^kaldi/.test(norm(t.text)));
  const letter=valid.includes(code)?code:valid.includes('DZ')&&absenceMark&&failed?'DZ':'';
  return {raw,letter,glyph:obsGlyph(crop),
   image:obsCell(canvas,left,y0,w-left,h).toDataURL('image/png')};
 });
 return obsMatchGlyphs(rows,32,10);
}
// Accept a PDF text table only when all student IDs, grades and results line up.
function obsTextLayerRows(items,valid){
 const tokens=items.filter(t=>t.str?.trim()).map(t=>({
  text:t.str.trim(),x:t.transform[4],y:t.transform[5],height:Math.max(1,t.height||0)
 }));
 const grades=tokens.filter(t=>/^(b\.?\s*notu|başarı notu|harf notu)$/iu.test(t.text));
 if(grades.length!==1)return null;
 const grade=grades[0],aligned=(a,b)=>Math.abs(a.y-b.y)<=Math.min(a.height,b.height)*.45;
 const header=tokens.filter(t=>aligned(t,grade));
 const id=header.find(t=>/^(ogrenci (no\.?|numarasi)|numara)$/.test(norm(t.text)));
 const status=header.find(t=>norm(t.text)==='sonuc');
 if(!id||!status||id.x>=grade.x||grade.x>=status.x)return null;
 const column=(t,h)=>Math.abs(t.x-h.x)<=Math.min((status.x-grade.x)*.42,h.height*2.25);
 const body=tokens.filter(t=>t.y<grade.y-grade.height*.5);
 const ids=body.filter(t=>column(t,id)&&/^\d{5,20}$/.test(t.text));
 const results=body.filter(t=>column(t,status)&&/^(gecti|kaldi)\.?$/.test(norm(t.text)));
 const letters=body.filter(t=>column(t,grade)&&valid.includes(t.text.toUpperCase()));
 if(!ids.length||ids.length!==letters.length||ids.length!==results.length||new Set(ids.map(t=>t.text)).size!==ids.length)return null;
 const topDown=(a,b)=>b.y-a.y;
 ids.sort(topDown);letters.sort(topDown);results.sort(topDown);
 return ids.every((t,i)=>aligned(t,letters[i])&&aligned(t,results[i])&&(!i||!aligned(t,ids[i-1])))
  ?ids.map((t,i)=>({letter:letters[i].text.toUpperCase(),raw:letters[i].text,source:[t.text,letters[i].text,results[i].text].join(' · ')}))
  :null;
}
function obsFileKey(file){return [file.name,file.size,file.lastModified].join('|')}
function confirmedObsDistribution(){
 const data=course.obsLetters;
 if(!data||!course.files[3].some(f=>obsFileKey(f)===data.key))return null;
 const counts=new Map(scale().map(([key])=>[key,0]));
 for(const [key,n] of data.counts)counts.set(key,n);
 return {counts,total:data.counts.reduce((s,[,n])=>s+n,0),conflicts:0,source:'OBS'};
}
async function reviewObsLetters(file) {
 const owner=course,valid=[...new Set([...scale().map(([k])=>k),'DZ'])];
 dialog('OBS harf notlarını oku','<p id="obsRead" role="status">Dönem sonu listesi okunuyor…</p>');
 const status=$('obsRead');let pdf,worker;
 try{
  await loadLibrary('pdfjsLib');pdfjsLib.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';
  pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const all=[];
  for(let i=1;i<=pdf.numPages;i++){
   if(!status.isConnected||!modal.open||owner!==course)return;
   status.textContent='Harf notları okunuyor · '+i+' / '+pdf.numPages;
   const page=await pdf.getPage(i);
   let canvas;
   try{
    const text=await page.getTextContent().catch(()=>null);
    const direct=text&&obsTextLayerRows(text.items,valid);
    if(direct){all.push(...direct);continue}
    if(!status.isConnected||!modal.open||owner!==course)return;
    worker??=await createRosterWorker();
    const normal=page.getViewport({scale:1}),v=page.getViewport({scale:3100/Math.max(normal.width,normal.height)});
    canvas=document.createElement('canvas');canvas.width=Math.round(v.width);canvas.height=Math.round(v.height);
    await page.render({viewport:v,canvasContext:canvas.getContext('2d')}).promise;
    all.push(...await obsPageLetters(canvas,worker,valid));
   }finally{if(canvas)canvas.width=0;page.cleanup()}
  }
  if(!status.isConnected||!modal.open||owner!==course)return;
  const rosterCount=new Set((owner.roster||[]).map(r=>r[0])).size;
  const discrepancy=rosterCount&&rosterCount!==all.length
   ?'<p><strong>Ders listesinde '+rosterCount+' öğrenci var.</strong> Kaynak PDF’deki satır sayısını karşılaştırın.</p>':'';
  const rows=all.map((r,i)=>'<tr><td>'+(i+1)+'</td><td>'+(r.source?esc(r.source):'<img alt="Kaynak satır '+(i+1)+'" src="'+r.image+'">')+'</td><td><select title="Okunan: '+esc(r.raw)+'" aria-label="Satır '+(i+1)+' harf notu" required><option value="">Seçin</option>'+valid.map(l=>'<option '+(l===r.letter?'selected':'')+'>'+esc(l)+'</option>').join('')+'</select></td></tr>').join('');
  dialog('OBS harf dağılımını kontrol et','<p>'+all.length+' satır okundu. Kaynak satırlardaki harfleri kontrol edin. Onayladığınız dağılım rapor ve grafiklerde kullanılır.</p>'+discrepancy+'<form id="obsReview"><table><thead><tr><th>Satır</th><th>Kaynak not satırı</th><th>Harf notu</th></tr></thead><tbody>'+rows+'</tbody></table><button class="primary">Dağılımı kullan</button></form>');
  $('obsReview').onsubmit=async e=>{
   e.preventDefault();const counts=new Map();
   for(const el of e.target.querySelectorAll('select'))counts.set(el.value,(counts.get(el.value)||0)+1);
   owner.obsLetters={key:obsFileKey(file),counts:[...counts]};owner.done[3]=false;await save();statsView();
  };
 }catch(err){if(status.isConnected&&modal.open&&owner===course)dialog('Harf notları okunamadı','<p>'+esc(err.message)+' Dosya pakette saklanıyor.</p>')}
 finally{if(worker)await worker.terminate();if(pdf)await pdf.destroy()}
}
