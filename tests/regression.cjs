const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const tests = [];
function test(name, run) { tests.push({ name, run }); }
test('Studio Control includes its complete transport without a separate script dependency', () => {
  const html=fs.readFileSync('admin.html','utf8');
  const embedded=html.match(/<script data-studio-transport>([\s\S]*?)<\/script>/);
  assert(embedded, 'transport must be embedded');
  assert.equal(embedded[1].replace(/\r\n/g,'\n').trim(), fs.readFileSync('upload-client.js','utf8').replace(/\r\n/g,'\n').trim());
  assert(!html.includes('src="upload-client.js"'));
});
test('every website API URL matches the current admin deployment', () => {
  const urls = ['admin.html', 'gallery.html', 'script.js', 'index.html'].map(name => {
    const matches = fs.readFileSync(name, 'utf8').match(/https:\/\/script\.google\.com\/macros\/s\/[^"\s]+\/exec/g);
    assert(matches && matches.length, name + ' must contain an API endpoint');
    return matches;
  }).flat();
  assert.equal(new Set(urls).size, 1, 'Publish the same deployment URL in all four website files');
});
function iterator(values) { let i = 0; return { hasNext: () => i < values.length, next: () => values[i++] }; }
function setup() {
  const sheets = new Map();
  function sheet(name, rows) {
    const value = { rows, getDataRange: () => ({ getValues: () => rows.map(r => [...r]) }), getLastRow: () => rows.length,
      appendRow: row => rows.push(row), getRange: (r,c) => ({ setValue: v => { rows[r-1][c-1] = v; }, setValues: values => { values.forEach((row,i) => { rows[r+i-1] = row; }); } }) };
    sheets.set(name, value); return value;
  }
  sheet('DianaBookings', [['ID','Timestamp','Name','Email','Phone','Session','Preferred Date','Location','Message','Status','Notes','Quote','Deposit','Other']]);
  sheet('Gallery', [['URL','Thumb','Category','Caption','Alt','Created','Featured','Active']]);
  sheet('Reviews', [['Timestamp','Session','Name','Rating','Message','Email','Approved','Featured']]);
  sheet('ClientGalleries', [['ID','Client','Password','Hash','Folder','Created']]);
  let token = 'admin-secret'; let locked = false; let busy = false; let nextId = 0;
  let sharingFailures = 0; let emailFailure = false;
  const folders = new Map(), emails = [];
  function folder(name) {
    const id = 'folder-' + nextId++; const files = [];
    const f = { id, name, files, getId: () => id, getFiles: () => iterator(files), getFilesByName: name => iterator(files.filter(f => f.name === name)), createFolder: folder,
      createFile: blob => {
        assert(locked, 'file writes require lock');
        const id = 'file-' + nextId++;
        const file = { name: blob.name, description: '', getParents: () => iterator([f]), isTrashed: () => false, getId: () => id, getName: () => file.name, getMimeType: () => blob.type,
          getSize: () => blob.bytes.length, getBlob: () => ({ getBytes: () => blob.bytes }),
          getDescription: () => file.description, setDescription: v => { file.description = v; },
          setSharing: () => { if (sharingFailures-- > 0) throw new Error('Sharing temporarily failed'); } };
        files.push(file); return file;
      } };
    folders.set(id,f); return f;
  }
  const root = folder('root');
  const ss = { getSheetByName: n => sheets.get(n), insertSheet: n => sheet(n,[]), getSpreadsheetTimeZone: () => 'America/Chicago', getUrl: () => 'https://docs.google.com/example' };
  const context = vm.createContext({ console, Date, JSON, Object, Number, String, Array,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => token }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (busy || locked) return false; locked = true; return true; }, hasLock: () => locked, releaseLock: () => { locked = false; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, v) => [...crypto.createHash('sha256').update(typeof v === 'string' ? v : Buffer.from(v)).digest()],
      base64Decode: v => [...Buffer.from(v,'base64')], base64Encode: v => Buffer.from(v).toString('base64'), newBlob: (bytes,type,name) => ({ bytes,type,name }), getUuid: () => crypto.randomUUID(), formatDate: d => d.toISOString().slice(0,10) },
    DriveApp: { Access: { ANYONE_WITH_LINK: 'link' }, Permission: { VIEW: 'view' }, getRootFolder: () => root, createFolder: folder,
      getFileById: id => { const file = [...folders.values()].flatMap(f => f.files).find(f => f.getId() === id); if (!file) throw new Error('File missing'); return file; },
      getFolderById: id => { if (!folders.has(id)) throw new Error('Folder missing'); return folders.get(id); }, getFoldersByName: name => iterator([...folders.values()].filter(f => f.name === name)) },
    GmailApp: { sendEmail: (...args) => { if (emailFailure) throw new Error('Quota exceeded'); emails.push(args); } }
  });
  vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),context);
  const post = payload => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).text);
  const get = parameter => JSON.parse(context.doGet({ parameter }).text);
  const admin = payload => post({ token, ...payload });
  const create = id => admin({ action: 'admin_create_gallery', gallery_id: id, password: 'a-strong-password', client_name: 'Client' });
  return { context, post, get, admin, create, sheets, folders, emails, root, locked: () => locked,
    token: value => { token = value; }, busy: value => { busy = value; }, sharingFailures: value => { sharingFailures = value; }, emailFailure: value => { emailFailure = value; } };
}
const jpeg = Buffer.from([255,216,255,224,0,1,2,3]).toString('base64');
const png = Buffer.from([137,80,78,71,13,10,26,10,0,1,2]).toString('base64');
const upload = (e, overrides = {}) => e.admin({ action: 'admin_add_gallery_image', gallery_id: 'client-one', file_name: 'photo.jpg', file_data: jpeg, ...overrides });

test('all page scripts and shared JS parse', () => {
  for (const name of fs.readdirSync('.').filter(n => n.endsWith('.html'))) {
    for (const match of fs.readFileSync(name,'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1], { filename: name });
  }
  for (const name of ['script.js','upload-client.js','gallery-download.js','apps-script/Code.gs']) new vm.Script(fs.readFileSync(name,'utf8'), { filename: name });
});
test('admin authentication fails closed, including null configuration', () => {
  const e = setup(); e.token(null);
  assert.equal(e.post({ action: 'admin_verify', token: null }).success,false);
  assert.equal(e.post({ action: 'admin_list_galleries' }).success,false);
  assert.equal(e.get({ action: 'admin_fetch_all', token: 'secret' }).success,false);
});
test('authorized admin read endpoints still work over POST', () => {
  const e=setup(); assert.equal(e.admin({action:'admin_fetch_all'}).success,true); assert.deepEqual(e.admin({action:'admin_list_galleries'}).galleries,[]);
});
test('repeated and renamed photo uploads reuse one file', () => {
  const e=setup(); assert.equal(e.create('client-one').success,true);
  const first=upload(e); assert.equal(first.success,true); assert.equal(first.duplicate,false);
  assert.equal(upload(e).fileId,first.fileId);
  assert.equal(upload(e,{file_name:'renamed.jpg'}).fileId,first.fileId);
  assert.equal(e.admin({action:'admin_list_galleries'}).galleries[0].image_count,1);
});
test('same filename with changed bytes remains a different image', () => {
  const e=setup(); e.create('client-one'); const first=upload(e);
  assert.notEqual(upload(e,{file_data:png}).fileId,first.fileId);
});
test('sharing failure after Drive write recovers without duplicate', () => {
  const e=setup(); e.create('client-one'); e.sharingFailures(1);
  assert.equal(upload(e).success,false); assert.equal(upload(e).duplicate,true);
  assert.equal(e.admin({action:'admin_list_galleries'}).galleries[0].image_count,1);
});
test('PNG MIME is detected from bytes, not client declarations', () => {
  const e=setup(); e.create('client-one'); assert.equal(upload(e,{file_name:'photo.png',file_data:png,file_type:'image/jpeg'}).success,true);
  assert.equal([...e.folders.values()].find(f=>f.name==='gallery_client-one').files[0].getMimeType(),'image/png');
});
test('unsupported and corrupt images are rejected', () => {
  const e=setup(); e.create('client-one');
  for (const data of ['', 'not base64!', Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')]) assert.equal(upload(e,{file_data:data}).success,false);
});
test('unknown gallery uploads cannot create orphan folders', () => {
  const e=setup(); assert.equal(upload(e).success,false); assert.equal(e.folders.size,1);
});
test('busy script lock rejects without creating files and allows retry', () => {
  const e=setup(); e.create('client-one'); e.busy(true); assert.equal(upload(e).retryable,true); e.busy(false); assert.equal(upload(e).success,true);
});
test('gallery creation rejects duplicate IDs and short new passwords', () => {
  const e=setup(); assert.equal(e.create('client-one').success,true); assert.equal(e.create('client-one').success,false);
  assert.equal(e.admin({action:'admin_create_gallery',gallery_id:'other',password:'short'}).success,false);
});
test('gallery reads authenticate and retain original filenames', () => {
  const e=setup(); e.create('client-one'); upload(e);
  assert.equal(e.post({action:'get_gallery',gallery_id:'client-one',password:'wrong'}).success,false);
  const result=e.post({action:'get_gallery',gallery_id:'client-one',password:'a-strong-password'});
  assert.equal(result.images[0].filename,'photo.jpg'); assert.equal(result.images.length,1);
});
test('missing existing folder fails instead of silently creating an empty gallery', () => {
  const e=setup(); e.create('client-one'); e.folders.delete(e.sheets.get('ClientGalleries').rows[1][4]);
  assert.equal(e.post({action:'get_gallery',gallery_id:'client-one',password:'a-strong-password'}).success,false);
});
test('portfolio uploads are idempotent and preserve metadata/columns', () => {
  const e=setup(); const data={action:'admin_add_gallery',file_data:jpeg,file_name:'p.jpg',category:'weddings',caption:'Caption',alt_text:'Alt'};
  assert.equal(e.admin(data).success,true); assert.equal(e.admin(data).duplicate,true);
  assert.equal(e.sheets.get('Gallery').rows.length,2); assert.equal(e.get({action:'gallery'}).data[0].caption,'Caption');
});
test('reviews require moderation; text is stored without formula execution', () => {
  const e=setup(); assert.equal(e.post({action:'submit_review',name:'=IMPORTXML("x")',rating:5,message:'Great'}).success,true);
  assert.equal(e.sheets.get('Reviews').rows[1][6],false); assert.equal(e.sheets.get('Reviews').rows[1][2][0],"'");
  assert.equal(e.get({action:'reviews'}).data.length,0);
  assert.equal(e.admin({action:'admin_update_review',row_index:2,approved:true,featured:false}).success,true);
  assert.equal(e.get({action:'reviews'}).data.length,1);
  assert.equal(e.admin({action:'admin_update_review',row_index:1,approved:true,featured:false}).success,false);
});
const booking={name:'<img src=x onerror=alert(1)>',email:'client@example.com',session_type:'Wedding',preferred_date:'2027-06-10',message:'<script>bad</script>'};
test('bookings and emails remain functional; submitted HTML is escaped', () => {
  const e=setup(); const result=e.post(booking); assert.equal(result.success,true);
  assert.equal(e.emails.length,2); assert.equal(e.emails[0][0],booking.email); assert(!e.emails[0][3].htmlBody.includes(booking.name));
  assert.deepEqual(e.get({}).bookedDates,['2027-06-10']);
  assert.equal(e.admin({action:'admin_update_booking',booking_id:result.booking_id,status:'Cancelled',notes:'=1+1'}).success,true);
  assert.deepEqual(e.get({}).bookedDates,[]); assert.equal(e.sheets.get('DianaBookings').rows[1][10],"'=1+1");
});
test('email failure does not report a saved booking as failed', () => {
  const e=setup(); e.emailFailure(true); assert.equal(e.post(booking).success,true); assert.equal(e.sheets.get('DianaBookings').rows.length,2);
});
test('unknown actions, invalid date and multi-recipient emails rejected', () => {
  const e=setup(); for (const data of [{...booking,action:'nonsense'}, {...booking,preferred_date:'2027-02-30'}, {...booking,email:'a@x.com,b@y.com'}]) assert.equal(e.post(data).success,false);
});
test('upload transport retries ambiguous failures with the identical payload', async () => {
  let calls=0; const bodies=[];
  const ctx=vm.createContext({ AbortController, setTimeout: (f,ms)=>ms===120000?0:setTimeout(f,0), clearTimeout,
    fetch: async (_,opts)=>{ bodies.push(opts.body); if (++calls<3) throw new Error('Network lost'); return {ok:true,json:async()=>({success:true,duplicate:true})}; } });
  vm.runInContext(fs.readFileSync('upload-client.js','utf8')+'\nthis.client = UploadClient;',ctx);
  assert.equal((await ctx.client.post('https://example.com',{file_data:jpeg},true)).duplicate,true); assert.equal(calls,3); assert.equal(new Set(bodies).size,1);
});
test('permanent validation failure is not automatically retried', async () => {
  let calls=0;
  const ctx=vm.createContext({ AbortController,setTimeout,clearTimeout,fetch: async()=>{calls++;return{ok:true,json:async()=>({success:false,error:'Invalid image'})};} });
  vm.runInContext(fs.readFileSync('upload-client.js','utf8')+'\nthis.client = UploadClient;',ctx);
  await assert.rejects(ctx.client.post('https://example.com',{},true),/Invalid image/); assert.equal(calls,1);
});
function adminUI(upload) {
  const elements = new Map();
  function element() { return { value:'',disabled:false,files:[],style:{},children:[],innerHTML:'',textContent:'',classList:{add(){},remove(){}},addEventListener(){},appendChild(child){this.children.push(child);},querySelector(){return this.label || (this.label=element());} }; }
  const document = { getElementById: id => {if(!elements.has(id)) elements.set(id,element());return elements.get(id);}, createElement:element };
  const transport = vm.createContext({});
  vm.runInContext(fs.readFileSync('upload-client.js','utf8')+'\nthis.batch = UploadClient.batch;', transport);
  const context = vm.createContext({ document, window:{addEventListener(){},location:{href:'https://example.com/studio/admin.html'}}, URL, console, alert(){}, testUpload:upload });
  const inline=[...fs.readFileSync('admin.html','utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
  vm.runInContext(inline,context);
  vm.runInContext('UploadClient.upload = testUpload;',context);
  vm.runInContext('loadGalleries = async () => {};',context);
  return {context,document};
}
test('client batch blocks double clicks and continues after a failed file', async () => {
  const seen=[]; let release;
  const gate = new Promise(resolve=>{release=resolve;});
  const e=adminUI(async(_,payload,file)=>{ seen.push(file.name);if(file.name==='one.jpg')await gate;if(file.name==='two.jpg')throw new Error('Network failed');return{success:true}; });
  e.document.getElementById('galleryUploadInput').files=[{name:'one.jpg'},{name:'two.jpg'},{name:'three.jpg'}];
  const first=e.context.uploadToGallery('client-one'); await e.context.uploadToGallery('client-one');
  assert.equal(seen.length,3); release(); await first;
  assert.deepEqual(seen,['one.jpg','two.jpg','three.jpg']);
  assert.equal(e.document.getElementById('clientUploadButton').disabled,false);
  assert.match(e.document.getElementById('galleryUploadStatus').children.at(-1).textContent,/2 uploaded; 0 already present; 1 failed/);
});
test('portfolio retries only failed entries and reports failures honestly', async () => {
  const seen=[]; let fail=true;
  const e=adminUI(async(_,payload,file)=>{seen.push(file.name);if(fail&&file.name==='bad.jpg')throw new Error('Failed');return{success:true};});
  vm.runInContext("uploadQueue = [{id:'q1',status:'pending',file:{name:'good.jpg'}},{id:'q2',status:'pending',file:{name:'bad.jpg'}}];",e.context);
  await e.context.uploadQueueItems(); assert.match(e.document.getElementById('portfolioUploadStatus').textContent,/1 succeeded; 1 failed/);
  fail=false; await e.context.uploadQueueItems(); assert.deepEqual(seen,['good.jpg','bad.jpg','bad.jpg']);
});
test('booking detail injection and gallery IDs cannot become inline code', () => {
  const e=adminUI(); const malicious='</textarea><img src=x onerror=alert(1)>';
  e.context.openBookingModal({booking_id:"x');alert(1);//",name:malicious,email:malicious,phone:malicious,session_type:malicious,preferred_date:malicious,location:malicious,message:malicious,notes:malicious,status:'Pending'});
  const html=e.document.getElementById('modalContent').innerHTML;
  assert(!html.includes('<img')); assert(!html.includes('onclick=')); assert(html.includes('&lt;img'));
  e.context.renderGalleries([{id:"x');alert(1);//",client_name:malicious,password:malicious}]);
  const row=e.document.getElementById('galleriesList').children[0]; assert(!row.innerHTML.includes('onclick=')); assert(!row.innerHTML.includes('<img'));
});
test('populated admin response renders bookings, review moderation and deliveries together', async () => {
  const e=adminUI();
  e.context.AbortController=AbortController;
  e.context.setTimeout=setTimeout;
  e.context.clearTimeout=clearTimeout;
  e.context.fetch=async()=>({ok:true,json:async()=>({success:true,
    bookings:[{booking_id:'DO-example',name:'Client',email:'client@example.com',session_type:'Wedding',preferred_date:'2027-06-10',status:'Confirmed'}],
    reviews:[{row_index:2,name:'Reviewer',session_type:'Wedding',message:'Great photos',rating:5,approved:false,featured:false}]
  })});
  e.document.getElementById('statusFilter').value = 'all';
  await e.context.loadBookings();
  assert.equal(e.document.getElementById('bookingTableBody').children.length,1);
  assert.equal(e.document.getElementById('reviewsTableBody').children.length,1);
  assert.equal(e.document.getElementById('clientDeliveriesTableBody').children.length,1);
  assert.equal(e.document.getElementById('confirmedCount').textContent,1);
  assert(!e.document.getElementById('bookingTableBody').innerHTML.includes('Failed'));
});
test('uploads above 20 MiB pass browser and server validation', () => {
  const e=setup(); e.create('client-one');
  e.context.Utilities.base64Decode = value => Buffer.from(value, 'base64');
  const bytes=Buffer.alloc(21*1024*1024); bytes.set([255,216,255]);
  assert.equal(upload(e,{file_data:bytes.toString('base64')}).success,true);
  const ctx=vm.createContext({}); vm.runInContext(fs.readFileSync('upload-client.js','utf8')+'\nthis.client=UploadClient;',ctx);
  assert.doesNotThrow(()=>ctx.client.validate({name:'large.jpg',size:bytes.length}));
});
test('download API requires password and checks the exact gallery folder', () => {
  const e=setup(); e.create('client-one'); const first=upload(e);
  e.create('client-two'); const other=upload(e,{gallery_id:'client-two'});
  const request={action:'download_gallery_image',gallery_id:'client-one',password:'a-strong-password',file_id:first.fileId};
  const result=e.post(request); assert.equal(result.file_data,jpeg); assert.equal(result.size,8);
  assert.equal(e.post({...request,password:'wrong'}).success,false);
  assert.equal(e.post({...request,file_id:other.fileId}).success,false);
  assert.equal(e.get(request).success,false);
  assert.equal(e.post({action:'get_gallery',gallery_id:'client-one',password:'a-strong-password'}).images[0].file_id,first.fileId);
});
function downloadUI(fetch, picker) {
  let downloaded; let clicked=0;
  const context=vm.createContext({zip:require('../vendor/zip-core-2.24.0.min.js'),window:picker?{showSaveFilePicker:picker}:{},
    WritableStream,AbortController,DOMException,Uint8Array,atob,fetch,
    setTimeout:(fn,ms)=>ms===60000?0:setTimeout(fn,ms),clearTimeout,
    URL:{createObjectURL:blob=>{downloaded=blob;return'blob:test';},revokeObjectURL(){}},
    document:{body:{appendChild(){}},createElement:()=>({click(){clicked++;},remove(){}})} });
  vm.runInContext(fs.readFileSync('gallery-download.js','utf8')+'\nthis.downloader=GalleryDownload;',context);
  return {context,blob:()=>downloaded,clicks:()=>clicked};
}
test('large photo ranges are authenticated, bounded and validated on the server', () => {
  const e=setup();e.create('client-one');const file=upload(e);
  let calls=0;
  e.context.ScriptApp={getOAuthToken:()=> 'server-only-token'};
  e.context.UrlFetchApp={fetch:(url,options)=>{
    calls++;assert(url.includes(encodeURIComponent(file.fileId)));
    assert.equal(options.headers.Range,'bytes=0-7');assert.equal(options.headers.Authorization,'Bearer server-only-token');
    return {getResponseCode:()=>206,getAllHeaders:()=>({'Content-Range':'bytes 0-7/8'}),getBlob:()=>({getBytes:()=>[...Buffer.from(jpeg,'base64')]})};
  }};
  const request={action:'download_gallery_image',gallery_id:'client-one',password:'a-strong-password',file_id:file.fileId,offset:0};
  const result=e.post(request);assert.equal(result.success,true);assert.equal(result.total_size,8);assert.equal(result.offset,0);assert.equal(result.file_data,jpeg);
  assert(!JSON.stringify(result).includes('server-only-token'));
  assert.equal(e.post({...request,password:'wrong'}).success,false);
  for(const offset of [-1,0.5,'0',8]) assert.equal(e.post({...request,offset}).success,false);
  assert.equal(calls,1);
  e.context.UrlFetchApp.fetch=()=>({getResponseCode:()=>200});
  assert.match(e.post(request).error,/requested photo range/);
  e.context.UrlFetchApp.fetch=()=>({getResponseCode:()=>429});
  assert.equal(e.post(request).retryable,true);
});
test('large original is reconstructed from bounded chunks with identical ZIP bytes', async () => {
  const bytes=Buffer.alloc(9*1024*1024+7,123);bytes.set([255,216,255]);
  const offsets=[];
  const e=downloadUI(async(_,options)=>{
    const {offset}=JSON.parse(options.body);offsets.push(offset);
    const part=bytes.subarray(offset,offset+4*1024*1024);
    return {ok:true,json:async()=>({success:true,file_data:part.toString('base64'),size:part.length,total_size:bytes.length,offset})};
  });
  await e.context.downloader.save({...downloadOptions(),images:[{file_id:'1',filename:'large.jpg',size:bytes.length}]});
  assert.deepEqual(offsets,[0,4*1024*1024,8*1024*1024]);
  const z=require('../vendor/zip-core-2.24.0.min.js');const reader=new z.ZipReader(new z.BlobReader(e.blob()));
  const [entry]=await reader.getEntries();assert.deepEqual(Buffer.from(await entry.getData(new z.Uint8ArrayWriter(),{useWebWorkers:false})),bytes);await reader.close();
});
test('range mismatch cannot produce a corrupted or partial ZIP', async () => {
  const e=downloadUI(async()=>({ok:true,json:async()=>({success:true,file_data:jpeg,size:8,total_size:9*1024*1024,offset:1})}));
  await assert.rejects(e.context.downloader.save({...downloadOptions(),images:[{file_id:'1',filename:'large.jpg',size:9*1024*1024}]}),/range mismatch/);
  assert.equal(e.clicks(),0);
});
const downloadOptions=()=>({url:'https://example.com',galleryId:'client-one',password:'password',images:[{file_id:'1',filename:'../photo.jpg'},{file_id:'2',filename:'../photo.jpg'}],signal:new AbortController().signal,onProgress(){}});
test('download produces one readable ZIP with every original and unique safe filenames', async () => {
  const calls=[];const e=downloadUI(async(_,opts)=>{calls.push(JSON.parse(opts.body));return{ok:true,json:async()=>({success:true,file_data:jpeg,size:8})};});
  const result=await e.context.downloader.save(downloadOptions());assert.equal(result.count,2);assert.equal(e.clicks(),1);
  const z=require('../vendor/zip-core-2.24.0.min.js');const reader=new z.ZipReader(new z.BlobReader(e.blob()));const entries=await reader.getEntries();
  assert.equal(entries.length,2);assert.notEqual(entries[0].filename,entries[1].filename);
  for(const entry of entries){assert(!entry.filename.includes('/'));assert.deepEqual(Buffer.from(await entry.getData(new z.Uint8ArrayWriter(),{useWebWorkers:false})),Buffer.from(jpeg,'base64'));}
  await reader.close();assert.equal(calls[0].action,'download_gallery_image');assert.equal(calls[0].password,'password');
});
test('download HTTP permission failures identify the photo and do not retry', async () => {
  let calls=0;
  const e=downloadUI(async()=>{calls++;return{ok:false,status:403};});
  await assert.rejects(e.context.downloader.save({...downloadOptions(),images:[{file_id:'1',filename:'portrait.jpg'}]}),/portrait.jpg:.*HTTP 403/);
  assert.equal(calls,1);assert.equal(e.clicks(),0);
});
test('invalid download response identifies a deployment problem without saving a ZIP', async () => {
  let calls=0;
  const e=downloadUI(async()=>{calls++;return{ok:true,json:async()=>({success:true})};});
  await assert.rejects(e.context.downloader.save({...downloadOptions(),images:[{file_id:'1',filename:'portrait.jpg'}]}),/portrait.jpg:.*original photo data/);
  assert.equal(calls,1);assert.equal(e.clicks(),0);
});
test('photo request timeout is not reported as user cancellation', async () => {
  const e=downloadUI(async(_,options)=>new Promise((resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
  }));
  e.context.setTimeout=(fn)=>setTimeout(fn,1);
  await assert.rejects(e.context.downloader.save({...downloadOptions(),images:[{file_id:'1',filename:'portrait.jpg'}]}),error=>error.name!=='AbortError' && /portrait.jpg:.*timed out/.test(error.message));
  assert.equal(e.clicks(),0);
});
test('failed photo never delivers a partial ZIP', async () => {
  let calls=0;const e=downloadUI(async()=>({ok:true,json:async()=>++calls===1?{success:true,file_data:jpeg,size:8}:{success:false,error:'Photo unavailable'}}));
  await assert.rejects(e.context.downloader.save(downloadOptions()),/Photo unavailable/);assert.equal(e.clicks(),0);
});
test('streaming ZIP writes directly to disk and cancellation aborts disk output', async () => {
  let closed=false,aborted=false;const chunks=[];
  const picker=async()=>({createWritable:async()=>({write:async chunk=>chunks.push(chunk),close:async()=>{closed=true;},abort:async()=>{aborted=true;}})});
  const e=downloadUI(async()=>({ok:true,json:async()=>({success:true,file_data:jpeg,size:8})}),picker);
  assert.equal((await e.context.downloader.save(downloadOptions())).savedToDisk,true);assert(closed);assert(!aborted);assert(chunks.length);assert.equal(e.clicks(),0);
  closed=false;const controller=new AbortController();controller.abort();
  await assert.rejects(e.context.downloader.save({...downloadOptions(),signal:controller.signal}),{name:'AbortError'});assert(aborted);assert(!closed);
});
test('upload preparation runs outside the shared Drive creation lock', () => {
  const e=setup();e.create('client-one');const decode=e.context.Utilities.base64Decode;
  e.context.Utilities.base64Decode=value=>{assert.equal(e.locked(),false);return decode(value);};
  assert.equal(upload(e).success,true);assert.equal(e.locked(),false);
});
test('upload pool overlaps requests and never exceeds three active transfers', async () => {
  const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('upload-client.js','utf8')+'\nthis.batch=UploadClient.batch;',ctx);
  let active=0,peak=0;const completed=[];
  await ctx.batch(Array.from({length:9},(_,i)=>i),async i=>{
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));completed.push(i);active--;
  });
  assert.equal(peak,3);assert.equal(new Set(completed).size,9);
});
test('ZIP downloads overlap three requests while keeping archive order', async () => {
  let active=0,peak=0;
  const e=downloadUI(async(_,options)=>{
    const id=Number(JSON.parse(options.body).file_id);active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,id===1?30:5));active--;
    return{ok:true,json:async()=>({success:true,file_data:jpeg,size:8})};
  });
  const images=Array.from({length:7},(_,i)=>({file_id:String(i+1),filename:`photo-${i+1}.jpg`}));
  await e.context.downloader.save({...downloadOptions(),images});assert.equal(peak,3);
  const z=require('../vendor/zip-core-2.24.0.min.js');const reader=new z.ZipReader(new z.BlobReader(e.blob()));
  assert.deepEqual((await reader.getEntries()).map(entry=>entry.filename),images.map((image,i)=>`${String(i+1).padStart(4,'0')} - ${image.filename}`));await reader.close();
});
module.exports = { setup };
if (require.main === module) (async()=>{let failed=0;for(const t of tests){try{await t.run();console.log('PASS '+t.name);}catch(error){failed++;console.error('FAIL '+t.name,error);}}console.log(`${tests.length-failed}/${tests.length} passed`);process.exitCode=failed?1:0;})();
