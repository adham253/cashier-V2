'use strict';
// Sedra experimental addon: offline camera barcode, searchable credit accounts, auditable settlements.
let cameraStream=null, cameraFrame=0, scannerActive=false;
function stopCamera(){scannerActive=false;if(cameraFrame)cancelAnimationFrame(cameraFrame);cameraFrame=0;if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}}
function paidForInvoice(invoice,moves){const number=invoice.number;return moves.filter(m=>m.type==='payment'&&(m.invoiceId===invoice.id||(m.invoiceNumber===number&&m.customerId===(invoice.customerId||norm(invoice.customerName))))).reduce((sum,m)=>sum+Math.abs(Number(m.amount)||0),0)}
function dueForInvoice(invoice,moves){return Math.max(0,Math.round((Number(invoice.total)-paidForInvoice(invoice,moves))*100)/100)}
function creditLabel(i,moves){return dueForInvoice(i,moves)<0.005?'مسددة':paidForInvoice(i,moves)>0?'مسددة جزئيًا':'غير مسددة'}
function creditClientId(i){return i.customerId||norm(i.customerName)}
async function addCustomer(name){name=String(name||'').trim();if(!name)return null;let id=norm(name);let old=await getOne('customers',id);if(old)return old;let cust={id,name,createdAt:nowISO(),lastSeenAt:null};let tx=db.transaction(['customers','syncQueue'],'readwrite');tx.objectStore('customers').add(cust);enqueue(tx,'customer_added',cust);await txDone(tx);updatePending();return cust}
async function openCreditSalePicker(){
 if(!cart.size){toast('الفاتورة فارغة');return}
 let customers=(await getAll('customers')).sort((a,b)=>a.name.localeCompare(b.name,'ar'));
 let selected='';
 showModal(`<h3>🧾 فاتورة آجل</h3><p class="helper">اختار عميل من القائمة أو ضيف عميل جديد. لا يمكن حفظ الآجل من غير عميل.</p><div class="field"><label>ابحث عن اسم العميل</label><input id="customerPickerSearch" placeholder="اكتب الاسم..." autocomplete="off"></div><div id="customerPickerList" class="customerList"></div><button id="newCustomerPicker" class="btn secondary wide">＋ إضافة عميل آجل جديد</button><div id="pickedName" class="good" style="display:none;margin:10px 0"></div><button id="saveCreditInvoice" class="btn wide" disabled>حفظ الفاتورة آجل</button>`);
 const list=$('#customerPickerList');const picked=$('#pickedName');const submit=$('#saveCreditInvoice');
 const paint=()=>{let q=norm($('#customerPickerSearch').value);let show=customers.filter(c=>!q||norm(c.name).includes(q)).slice(0,60);
 list.innerHTML=show.length?show.map(c=>`<button type="button" class="customerRow ${selected===c.id?'active':''}" data-customer="${escAttr(c.id)}"><strong>${esc(c.name)}</strong><span>اختيار</span></button>`).join(''):'<div class="empty">لا يوجد عميل بهذا الاسم</div>';
 list.querySelectorAll('[data-customer]').forEach(b=>b.onclick=()=>{selected=b.dataset.customer;picked.textContent='العميل: '+customers.find(c=>c.id===selected).name;picked.style.display='block';submit.disabled=false;paint()})};
 $('#customerPickerSearch').oninput=paint;paint();
 $('#newCustomerPicker').onclick=()=>{let name=$('#customerPickerSearch').value.trim();showModal(`<h3>إضافة عميل آجل</h3><div class="field"><label>اسم العميل الجديد</label><input id="newCreditName" placeholder="اسم العميل" value="${escAttr(name)}"></div><button class="btn wide" id="confirmNewCustomer">حفظ واختيار العميل</button><button class="btn secondary wide" id="backToCredit" style="margin-top:7px">رجوع</button>`);
 $('#backToCredit').onclick=openCreditSalePicker;
 $('#confirmNewCustomer').onclick=async()=>{let name=$('#newCreditName').value.trim();if(!name){toast('اكتب اسم العميل');return}let c=await addCustomer(name);await openCreditSalePicker();let input=$('#customerPickerSearch');input.value=c.name;input.dispatchEvent(new Event('input'));let b=[...$('#customerPickerList').querySelectorAll('[data-customer]')].find(b=>b.dataset.customer===c.id);if(b)b.click()}};
 submit.onclick=async()=>{if(!selected)return;let c=customers.find(x=>x.id===selected);submit.disabled=true;try{let inv=await saveInvoice('credit',c.name);if(inv)closeModal();else submit.disabled=false}catch(err){console.error(err);toast('تعذر حفظ الفاتورة. حاول مرة تانية');submit.disabled=false}};
}
async function renderCredit(){
 let customers=(await getAll('customers')).sort((a,b)=>a.name.localeCompare(b.name,'ar'));
 let moves=await getAll('creditMoves');let q=norm($('#creditSearch')?.value||'');let list=customers.filter(c=>!q||norm(c.name).includes(q));
 $('#creditCustomers').innerHTML=list.length?list.map(c=>{let balance=moves.filter(m=>m.customerId===c.id).reduce((s,m)=>s+Number(m.amount||0),0);return `<button type="button" class="customerRow" data-credit-customer="${escAttr(c.id)}"><strong>${esc(c.name)}</strong><span style="font-weight:800;color:${balance>0?'#ab6200':'#28744e'}">${money(balance)}</span></button>`}).join(''):'<div class="empty">لا يوجد عملاء. اضغط + عميل لإضافة واحد.</div>';
 $('#creditCustomers').querySelectorAll('[data-credit-customer]').forEach(b=>b.onclick=()=>showCreditCustomer(b.dataset.creditCustomer));
}
$('#creditSearch').addEventListener('input',renderCredit);
$('#addCustomerQuick').onclick=()=>{showModal(`<h3>إضافة عميل آجل</h3><div class="field"><label>اسم العميل</label><input id="addQuickName" placeholder="اسم العميل"></div><button id="saveQuickName" class="btn wide">إضافة العميل</button>`);$('#saveQuickName').onclick=async()=>{let c=await addCustomer($('#addQuickName').value);if(!c){toast('اكتب اسم العميل');return}closeModal();await renderCredit();await showCreditCustomer(c.id)}};
async function showCreditCustomer(id){
 const c=await getOne('customers',id);if(!c){toast('العميل غير موجود');return}
 const allInv=await getAll('invoices');const moves=(await getAll('creditMoves')).filter(m=>m.customerId===id);
 const invoices=allInv.filter(i=>i.paymentType==='credit'&&creditClientId(i)===id&&i.status==='posted').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const sales=moves.filter(m=>m.type==='sale').reduce((s,m)=>s+Number(m.amount||0),0);
 const collections=moves.filter(m=>m.type==='payment').reduce((s,m)=>s+Math.abs(Number(m.amount)||0),0);
 const balance=sales-collections;
 const unassigned=collections-invoices.reduce((s,i)=>s+paidForInvoice(i,moves),0);
 const open=invoices.filter(i=>dueForInvoice(i,moves)>0.004);
 const html=`<div class="card"><div class="row"><h3 style="margin:0">${esc(c.name)}</h3><button class="btn secondary" id="creditBack">تحديث</button></div><div class="stats" style="margin-top:10px"><div class="stat"><span class="small">المتبقي على العميل</span><b>${money(balance)}</b></div><div class="stat"><span class="small">المدفوع</span><b>${money(collections)}</b></div></div>${unassigned>0.005?`<div class="warn" style="margin-top:9px">يوجد ${money(unassigned)} تحصيلات قديمة غير مربوطة بفواتير محددة؛ راجعها قبل تسوية الفواتير القديمة.</div>`:''}<div class="creditBtns" style="margin-top:12px"><button id="showOpenOnly" class="btn secondary">الفواتير المفتوحة (${open.length})</button><button id="showAllCredit" class="btn secondary">كل التاريخ (${invoices.length})</button></div><div id="customerInvoices"></div><div class="hr"></div><b>سجل الحركات</b><div class="small">كل بيع أو تحصيل محفوظ بالتاريخ ولا يُحذف</div>${moves.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(m=>`<div class="historyItem"><div class="row"><span>${m.type==='sale'?'🧾 فاتورة آجل':'💵 تحصيل'}</span><b>${m.type==='sale'?'+':'−'} ${money(Math.abs(m.amount))}</b></div><div class="sub">${new Date(m.createdAt).toLocaleString('ar-EG')} · ${esc(m.invoiceNumber||m.reference||'')}</div></div>`).join('')||'<div class="small">لا توجد حركات</div>'}</div>`;
 $('#creditDetails').innerHTML=html;
 const pane=$('#customerInvoices');const paint=(showAll)=>{let relevant=showAll?invoices:open;pane.innerHTML=relevant.length?relevant.map(i=>{let paid=paidForInvoice(i,moves),due=dueForInvoice(i,moves);return `<div class="invoice"><div class="row"><b>${esc(i.number)}</b><span class="miniPill ${due>0?'due':''}">${creditLabel(i,moves)}</span></div><div class="row" style="margin-top:8px"><span class="small">${new Date(i.createdAt).toLocaleString('ar-EG')}</span><b>${money(i.total)}</b></div><div class="row" style="margin-top:7px"><span class="small">المتبقي ${money(due)} ${paid?'· المدفوع '+money(paid):''}</span><button class="btn ${due>0?'':'secondary'}" data-open-invoice="${escAttr(i.id)}">${due>0?'سداد / تفاصيل':'عرض الفاتورة'}</button></div></div>`}).join(''):'<div class="empty">لا توجد فواتير غير مسددة</div>';
 pane.querySelectorAll('[data-open-invoice]').forEach(b=>b.onclick=()=>showInvoiceDetails(b.dataset.openInvoice))};
 $('#showOpenOnly').onclick=()=>paint(false);$('#showAllCredit').onclick=()=>paint(true);$('#creditBack').onclick=()=>showCreditCustomer(id);paint(false);
}
async function showInvoiceDetails(id){
 const invoice=await getOne('invoices',id);if(!invoice){toast('الفاتورة غير موجودة');return}
 const lines=(await getAll('invoiceItems')).filter(it=>it.invoiceId===id);
 const moves=invoice.paymentType==='credit'?(await getAll('creditMoves')).filter(m=>m.customerId===creditClientId(invoice)):[];
 const paid=paidForInvoice(invoice,moves),due=dueForInvoice(invoice,moves);
 showModal(`<h3>تفاصيل الفاتورة ${esc(invoice.number)}</h3><p class="small">${new Date(invoice.createdAt).toLocaleString('ar-EG')}</p><div class="row"><b>${invoice.paymentType==='cash'?'كاش':'آجل · '+esc(invoice.customerName)}</b><span class="miniPill ${due>0?'due':''}">${invoice.paymentType==='cash'?'مدفوعة نقدًا':creditLabel(invoice,moves)}</span></div><div class="hr"></div>${lines.map(i=>`<div class="historyItem row"><span>${esc(i.productName)}<span class="sub">${fmtQty(i.qty)} × ${money(i.price)}</span></span><b>${money(i.total)}</b></div>`).join('')}<div class="hr"></div><div class="row"><b>الإجمالي</b><b>${money(invoice.total)}</b></div>${invoice.paymentType==='credit'?`<div class="row" style="margin-top:9px"><span>المدفوع</span><b>${money(paid)}</b></div><div class="row"><span>المتبقي</span><b class="customerBalance">${money(due)}</b></div>${due>0?`<div class="field" style="margin-top:16px"><label>المبلغ المستلم من العميل (يمكن دفع جزء)</label><input id="invoicePaymentAmount" type="number" inputmode="decimal" min="0.01" step="0.01" max="${due}" value="${due}"></div><button class="btn wide" id="settleInvoiceBtn">💵 تسجيل السداد</button>`:'<div class="good" style="margin-top:12px">تم سداد الفاتورة. محفوظة في سجل العميل ويمكن إخفاؤها من الفواتير المفتوحة.</div>'}`:''}<button id="backInvoice" class="btn secondary wide" style="margin-top:8px">إغلاق</button>`);
 $('#backInvoice').onclick=closeModal;
 let btn=$('#settleInvoiceBtn');if(btn)btn.onclick=async()=>{
 const amount=Number($('#invoicePaymentAmount').value);if(!Number.isFinite(amount)||amount<=0||amount>due+0.005){toast('المبلغ لازم يكون أكبر من صفر وأقل من المتبقي');return}
 if(!confirm(`تأكيد استلام ${money(amount)} نقدًا من ${invoice.customerName}؟`))return;
 btn.disabled=true;
 try{
 const crNow=(await getAll('creditMoves')).filter(m=>m.customerId===creditClientId(invoice));const current=dueForInvoice(invoice,crNow);if(amount>current+0.005)throw new Error('القيمة زادت عن المتبقي، افتح الفاتورة مرة أخرى');
 const at=nowISO(),dk=dateKey();
 const cr={id:rid('CR'),customerId:creditClientId(invoice),customerName:invoice.customerName,dateKey:dk,createdAt:at,type:'payment',amount:-amount,invoiceId:invoice.id,invoiceNumber:invoice.number,reference:invoice.number};
 const cm={id:rid('CM'),dateKey:dk,createdAt:at,type:'credit_collection',amount,reference:invoice.number,customerName:invoice.customerName,invoiceId:invoice.id};
 const tx=db.transaction(['creditMoves','cashMoves','syncQueue'],'readwrite');tx.objectStore('creditMoves').add(cr);tx.objectStore('cashMoves').add(cm);enqueue(tx,'credit_collection',{creditMove:cr,cashMove:cm});await txDone(tx);
 closeModal();toast('تم تسجيل التحصيل بنجاح');updatePending();renderCredit();showCreditCustomer(creditClientId(invoice));if(navigator.onLine)trySync();
 }catch(e){console.error(e);toast(e.message||'تعذر تسجيل السداد');btn.disabled=false}
 };
}
// Use native phone camera barcode support. Does not download any decoder, so it also works offline when supported by the device/browser.
$('#scanBtn').onclick=openBarcodeScanner;
async function openBarcodeScanner(){
 if(!window.isSecureContext){toast('الكاميرا تحتاج رابط HTTPS');return}
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){toast('المتصفح لا يدعم تشغيل الكاميرا');return}
 if(typeof BarcodeDetector==='undefined'){
 showModal(`<h3>مسح الباركود</h3><div class="warn">متصفح الموبايل ده لا يدعم قراءة الباركود بالكاميرا في النسخة التجريبية.</div><div class="field" style="margin-top:12px"><label>اكتب رقم الباركود يدويًا</label><input id="manualBarcode" inputmode="numeric" placeholder="رقم الباركود"></div><button id="manualBarcodeGo" class="btn wide">بحث عن الصنف</button>`);
 $('#manualBarcodeGo').onclick=()=>{let v=$('#manualBarcode').value.trim();if(!v){toast('اكتب رقم الباركود');return}closeModal();handleBarcode(v)};return;
 }
 showModal(`<h3>📷 مسح باركود المنتج</h3><p class="helper">اسمح باستخدام الكاميرا، ووجّه الكاميرا الخلفية إلى الخطوط السوداء على العبوة.</p><div class="scannerWrap"><video autoplay muted playsinline id="scanVideo" class="scannerVideo"></video><div class="scannerTarget"></div></div><div id="scannerHint" class="helper" style="margin-top:9px">جاري تشغيل الكاميرا...</div><button id="stopScan" class="btn secondary wide" style="margin-top:10px">إغلاق الكاميرا</button>`);
 $('#stopScan').onclick=closeModal;
 try{
 const detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf']});
 const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
 if(!$('#scanVideo')){stream.getTracks().forEach(t=>t.stop());return}
 cameraStream=stream;scannerActive=true;let video=$('#scanVideo');video.srcObject=stream;await video.play();$('#scannerHint').textContent='ضع الباركود داخل الإطار. القراءة تتم بدون إنترنت.';
 let next=0;const scan=async timestamp=>{if(!scannerActive)return;if(timestamp-next<260){cameraFrame=requestAnimationFrame(scan);return}next=timestamp;
 try{let codes=await detector.detect(video);if(!scannerActive)return;if(codes.length){let raw=String(codes[0].rawValue||'').trim();if(raw){stopCamera();closeModal();await handleBarcode(raw);return}}}catch(err){console.warn('barcode frame',err)}if(scannerActive)cameraFrame=requestAnimationFrame(scan)};
 cameraFrame=requestAnimationFrame(scan)
 }catch(err){stopCamera();console.error(err);let hint=$('#scannerHint');if(hint)hint.textContent=err.name==='NotAllowedError'?'لازم تسمح للتطبيق باستخدام الكاميرا من إعدادات المتصفح.':'تعذر تشغيل الكاميرا. جرّب Chrome أو اكتب الكود يدويًا.'}
}
async function handleBarcode(raw){
 raw=String(raw).trim();let all=await getAll('products');let p=all.find(x=>x.active!==false&&(String(x.barcode||'').trim()===raw||String(x.id).toUpperCase()===raw.toUpperCase()));
 if(p){await addToCart(p.id);toast('اتضاف للفاتورة: '+p.name);return}
 showModal(`<h3>باركود غير معروف</h3><div class="warn">الباركود <b dir="ltr">${esc(raw)}</b> مش مربوط بصنف عندك لسه.</div><div class="card" style="margin-top:12px"><label class="small">اربط الباركود بصنف موجود</label><input id="barcodeProductSearch" class="search" placeholder="ابحث عن الصنف باسمه"><div id="barcodeProductResults" class="customerList"></div></div><button id="barcodeNewProduct" class="btn secondary wide">＋ إضافة صنف جديد بهذا الباركود</button>`);
 const filter=async()=>{let q=norm($('#barcodeProductSearch').value);let list=all.filter(x=>x.active!==false&&q&&norm(x.name).includes(q)).slice(0,15);$('#barcodeProductResults').innerHTML=list.map(p=>`<button type="button" class="customerRow" data-link="${escAttr(p.id)}">${esc(p.name)}</button>`).join('');$('#barcodeProductResults').querySelectorAll('[data-link]').forEach(b=>b.onclick=async()=>{let p=await getOne('products',b.dataset.link);if(!p)return;if(p.barcode&&p.barcode!==raw){toast('الصنف ليه باركود مختلف بالفعل');return}p={...p,barcode:raw,updatedAt:nowISO()};let tx=db.transaction(['products','syncQueue'],'readwrite');tx.objectStore('products').put(p);enqueue(tx,'product_barcode_linked',{productId:p.id,barcode:raw});await txDone(tx);closeModal();await addToCart(p.id);toast('اتربط الباركود واتضاف الصنف')})};
 $('#barcodeProductSearch').oninput=filter;
 $('#barcodeNewProduct').onclick=()=>{showAddProduct();let f=$('#npBarcode');if(f)f.value=raw};
}
