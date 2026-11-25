// Clears what this browser keeps. Courses are deleted only when that option is ticked and confirmed.
function resetView(){
 const total=courseList.length;
 if(!total&&!obsAvailable){notify('Sıfırlanacak kayıt yok.');return}
 dialog('Sıfırla','<form id="resetForm">'+
  (obsAvailable?'<label><input type="checkbox" name="choices" checked><span>OBS bağlantısı ve son seçimler <span class="sub">OBS penceresi kapanır, sonraki bağlantıda yeniden giriş istenir. Hatırlanan dönem ve belge türleri unutulur.</span></span></label>':'')+
  (total?'<label><input type="checkbox" name="courses"><span>Bu tarayıcıdaki tüm dersler ('+total+') <span class="sub">Belgeler, öğrenci listeleri ve notlar kalıcı olarak silinir. Saklamak istediklerinizi önce Paketi İndir ile alın.</span></span></label>':'')+
  '<p id="resetStatus" role="status"></p><div class="actions"><button class="primary">'+icon('rotate-ccw')+'Sıfırla</button>'+
  (course?'<button type="button" id="resetCourse">'+icon('trash-2')+'Yalnızca seçili dersi sil</button>':'')+btn('Vazgeç','modal.close()').replace('<button','<button type="button"')+'</div></form>');
 const form=$('resetForm');
 if(course)$('resetCourse').onclick=()=>confirmCourseDelete();
 form.onsubmit=async event=>{
  event.preventDefault();
  const choices=Boolean(form.elements.choices?.checked),all=Boolean(form.elements.courses?.checked);
  if(!choices&&!all){$('resetStatus').textContent='Sıfırlanacak bir seçenek işaretleyin.';return}
  if(all&&!window.confirm(courseList.length+' ders, tüm belgeleri ve öğrenci kayıtlarıyla birlikte bu cihazdan kalıcı olarak silinsin mi?\n\n'+courseList.map(c=>c.code+' · '+c.name).join('\n')))return;
  form.querySelector('.primary').disabled=true;
  try{
   if(choices){
    await obsLeave();
    localStorage.removeItem('obsChoice');
   }
   if(all)await clearCourses();
  }catch(error){
   if(form.isConnected){$('resetStatus').textContent=error.message;form.querySelector('.primary').disabled=false}
   return;
  }
  if(form.isConnected&&modal.open){modal.close();$('modalbody').replaceChildren()}
  render();
  notify(all?'Tüm dersler silindi.':'OBS bağlantısı ve son seçimler sıfırlandı.');
 };
}
async function clearCourses(){
 await new Promise((resolve,reject)=>{
  const tx=db.transaction('courses','readwrite');
  const expected=new Map(courseList.map(c=>[c.id,c.storageRevision??0]));
  const store=tx.objectStore('courses');
  let conflict=false;
  const cursor=store.openCursor();
  cursor.onsuccess=()=>{
   const row=cursor.result;
   if(row&&expected.get(row.key)===(row.value.storageRevision??0)){
    expected.delete(row.key);row.continue();return;
   }
   if(row||expected.size){conflict=true;tx.abort();return}
   store.clear();
  };
  tx.oncomplete=resolve;
  tx.onabort=()=>reject(new Error(conflict?'Dersler başka bir sekmede değişti. Sayfayı yenileyip tekrar kontrol edin.':'Dersler silinemedi. Yeniden deneyin.'));
 });
 // The import marker of the previous app stays, otherwise old courses would come back on reload.
 courseList=[];course=undefined;opened=-1;filter=0;
 localStorage.removeItem('selectedCourse');
}
for(const button of document.querySelectorAll('.reset-open'))button.onclick=resetView;
