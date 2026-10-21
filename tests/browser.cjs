// Real Chromium DOM tests; all network calls are intercepted. No live data or emails.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setup } = require('./regression.cjs');
const root = path.resolve(__dirname, '..');
const backend = setup();
backend.post({name:'Test Client',email:'test@example.com',session_type:'Wedding',preferred_date:'2027-06-10',message:'Test inquiry'});
backend.post({action:'submit_review',name:'Test Reviewer',rating:5,message:'Test review'});
backend.create('client-one');
const photo=Buffer.from([255,216,255,224,0,1,2,3]);
backend.admin({action:'admin_add_gallery_image',gallery_id:'client-one',file_name:'test.jpg',file_data:photo.toString('base64')});
let failures=0;
(async()=>{
  const browser=await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  try {
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
    await context.route('**/*', async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='script.google.com') {
        const result=route.request().method()==='POST' ? backend.post(route.request().postDataJSON()) : backend.get(Object.fromEntries(url.searchParams));
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
      }
      if(url.hostname!=='studio.test') return route.fulfill({status:200,contentType:'text/plain',body:''});
      const name=decodeURIComponent(url.pathname).replace(/^\//,'');
      const target=path.resolve(root,name||'index.html');
      if(!target.startsWith(root+path.sep)||!fs.existsSync(target)) return route.fulfill({status:404,body:'Missing local file'});
      const contentType={'.html':'text/html','.js':'application/javascript','.css':'text/css','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png'}[path.extname(target)]||'application/octet-stream';
      return route.fulfill({status:200,contentType,body:fs.readFileSync(target)});
    });
    async function check(name, run) {
      const page=await context.newPage();const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      try {await run(page);assert.deepEqual(errors,[]);console.log('PASS '+name);}
      catch(error){failures++;console.error('FAIL '+name+': '+error.message);}
      finally{await page.close();}
    }
    for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.html'))) {
      await check('page load '+name,async page=>{
        await page.goto('https://studio.test/'+name);await page.waitForLoadState('load');
        const duplicateIds=await page.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id).filter((id,i,ids)=>ids.indexOf(id)!==i));
        assert.deepEqual(duplicateIds,[]);
      });
    }
    await check('admin login, bookings, details, tabs, reviews, deliveries, portfolio upload',async page=>{
      await page.goto('https://studio.test/admin.html');
      await page.locator('#gateToken').fill('admin-secret');await page.locator('#loginBtn').click();
      await page.getByRole('button',{name:'View',exact:true}).first().waitFor();
      assert.match(await page.locator('#bookingTableBody').innerText(),/Test Client/);
      await page.getByRole('button',{name:'View',exact:true}).first().click();
      await page.locator('#modalStatus').selectOption('Confirmed');await page.locator('#saveBookingButton').click();
      await page.locator('#bookingModal').waitFor({state:'hidden'});
      await page.getByRole('button',{name:'Client Deliveries',exact:true}).click();
      assert.match(await page.locator('#clientDeliveriesTableBody').innerText(),/Test Client/);
      await page.getByRole('button',{name:'Portfolio Manager',exact:true}).click();
      assert(await page.locator('#dropZone').isVisible());
      assert.match(await page.locator('#reviewsTableBody').innerText(),/Test Reviewer/);
      await page.locator('#fileInput').setInputFiles({name:'portfolio.jpg',mimeType:'image/jpeg',buffer:photo});
      await page.getByRole('button',{name:'Publish Assets to Live Portfolio'}).click();
      await page.locator('#portfolioUploadStatus').filter({hasText:'1 succeeded; 0 failed'}).waitFor();
      await page.getByRole('button',{name:'Client Galleries',exact:true}).click();
      assert.match(await page.locator('#galleriesList').innerText(),/client-one/);
    });
    await check('public portfolio folder grid visible and opens lightbox',async page=>{
      await page.goto('https://studio.test/portfolio.html');
      await page.locator('.portfolio-folder-card').first().waitFor({state:'attached'});
      assert(await page.locator('#folderDirectoryGrid').isVisible(),'Folder grid is hidden by CSS');
      await page.locator('.portfolio-folder-card').first().click();await page.locator('#dynamicPortfolioGrid .portfolio-item').first().click();
      assert(await page.locator('#imageLightbox').isVisible());
    });
    for (const brokenSection of ['bookings','reviews']) {
      await check('malformed '+brokenSection+' does not blank the other admin section',async page=>{
        await page.route('https://script.google.com/**',async route=>{
          const payload=route.request().postDataJSON();
          const result=backend.post(payload);
          if(payload.action==='admin_fetch_all') result[brokenSection]=null;
          await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
        });
        await page.goto('https://studio.test/admin.html');
        await page.locator('#gateToken').fill('admin-secret');await page.locator('#loginBtn').click();
        const brokenTable=brokenSection==='bookings'?'#bookingTableBody':'#reviewsTableBody';
        await page.locator(brokenTable).filter({hasText:'invalid '+brokenSection+' data'}).waitFor({state:'attached'});
        assert.match(await page.locator(brokenSection==='bookings'?'#reviewsTableBody':'#bookingTableBody').innerText(),/Test (Client|Reviewer)/);
      });
    }
    await check('placeholder footer link does not throw',async page=>{
      await page.goto('https://studio.test/about.html');await page.getByRole('link',{name:'Privacy Policy',exact:true}).click();
    });
    await check('missing gallery ID displays its error',async page=>{
      await page.goto('https://studio.test/gallery.html');assert(await page.locator('#gateMsg').isVisible(),'Gallery error is inside hidden authGate');
    });
    await check('client unlock renders originals and download controls',async page=>{
      await page.goto('https://studio.test/gallery.html?id=client-one');await page.locator('#galleryPass').fill('a-strong-password');await page.locator('#unlockBtn').click();
      await page.locator('#galleryView').waitFor({state:'visible'});assert.equal(await page.locator('#photoGrid img').count(),1);assert(await page.locator('#downloadAllBtn').isEnabled());
    });
    await check('booking wizard completes using native date fallback',async page=>{
      await page.goto('https://studio.test/contact.html');await page.locator('.session-card').first().click();
      assert.equal(await page.locator('#preferred_date').getAttribute('type'),'date');
      await page.locator('[name=name]').fill('Browser Client');await page.locator('[name=email]').fill('browser@example.com');
      await page.locator('#preferred_date').fill('2027-09-10');await page.locator('[name=message]').fill('Browser test');
      await page.locator('#nextBtn-2').click();await page.locator('#submitBtn').click();
      await page.locator('#success-ref-id').filter({hasText:'DO-'}).waitFor();assert(await page.locator('#wizard-success').isVisible());
    });
    await check('real ZIP survives blocked picker and can be saved again without refetching',async page=>{
      await page.goto('https://studio.test/gallery.html?id=client-one');
      await page.locator('#galleryPass').fill('a-strong-password');await page.locator('#unlockBtn').click();
      await page.locator('#galleryView').waitFor({state:'visible'});
      await page.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('Blocked','SecurityError');};});
      let requests=0;page.on('request',request=>{if(request.postData()?.includes('download_gallery_image')) requests++;});
      const started=page.waitForEvent('download');await page.locator('#downloadAllBtn').click();
      const download=await started;
      const saved=await download.path();
      const z=require('../vendor/zip-core-2.24.0.min.js');
      const reader=new z.ZipReader(new z.Uint8ArrayReader(fs.readFileSync(saved)));
      const entries=await reader.getEntries();assert.equal(entries.length,1);
      assert.deepEqual(Buffer.from(await entries[0].getData(new z.Uint8ArrayWriter(),{useWebWorkers:false})),photo);
      await reader.close();
      assert(await page.locator('#saveZipLink').isVisible());
      const again=page.waitForEvent('download');await page.locator('#saveZipLink').click();await again;
      assert.equal(requests,1,'saving the prepared ZIP must not refetch originals');
    });
    for (const outcome of ['disk','browser','error','cancelled']) {
      await check('ZIP confirmation accurately reports '+outcome,async page=>{
        await page.goto('https://studio.test/gallery.html?id=client-one');
        await page.locator('#galleryPass').fill('a-strong-password');await page.locator('#unlockBtn').click();
        await page.locator('#galleryView').waitFor({state:'visible'});
        // Exercise UI states; regression tests separately validate real ZIP writing and closing.
        await page.evaluate(outcome=>{
          GalleryDownload.save=async ({onProgress,onReady})=>{
            onProgress('Finishing your ZIP download…');
            await new Promise(resolve=>setTimeout(resolve,100));
            if(outcome==='error') throw new Error('Photo unavailable');
            if(outcome==='cancelled') throw new DOMException('Cancelled','AbortError');
            if(outcome==='browser') onReady({url:URL.createObjectURL(new Blob(['zip'])),filename:'client-one-photos.zip'});
            return {count:1,savedToDisk:outcome==='disk'};
          };
        },outcome);
        await page.locator('#downloadAllBtn').click();
        const status=page.locator('#downloadStatus');
        await page.waitForFunction(()=>document.getElementById('downloadStatus').getAttribute('aria-busy')==='false');
        assert(await status.isVisible());
        const message=await status.innerText();
        if(outcome==='disk') assert.match(message,/Download complete.*saved successfully with all 1 original photos/);
        if(outcome==='browser') {
          assert.match(message,/Save your ZIP/);assert(!message.includes('saved successfully'));
          assert(await page.locator('#saveZipLink').isVisible());
          const download=page.waitForEvent('download');await page.locator('#saveZipLink').click();
          assert.equal((await download).suggestedFilename(),'client-one-photos.zip');
        } else assert(await page.locator('#saveZipLink').isHidden());
        if(outcome==='error') {assert.match(message,/Download did not finish: Photo unavailable/);assert.equal(await status.getAttribute('class'),'msg error');}
        if(outcome==='cancelled') {assert.match(message,/Download cancelled/);assert.notEqual(await status.getAttribute('class'),'msg success');}
        assert(await page.locator('#downloadAllBtn').isEnabled());assert(await page.locator('#cancelDownloadBtn').isHidden());
      });
    }
    await check('gallery confirms every image, reports failure, and retries only failed previews',async page=>{
      const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
      const calls={};let fail=true;
      await page.route('https://preview.test/**',async route=>{
        const id=new URL(route.request().url()).pathname;calls[id]=(calls[id]||0)+1;
        if(id==='/2'&&fail) return route.fulfill({status:404,body:''});
        await new Promise(resolve=>setTimeout(resolve,80));
        await route.fulfill({contentType:'image/png',body:png});
      });
      await page.goto('https://studio.test/gallery.html?id=client-one');
      await page.evaluate(()=>{
        document.getElementById('galleryView').style.display='block';
        renderPhotos(Array.from({length:6},(_,i)=>({filename:`photo-${i}`,url:`https://preview.test/${i}`})));
      });
      assert.match(await page.locator('#photoLoadStatus').innerText(),/Loading your gallery/);
      await page.locator('#photoLoadStatus').filter({hasText:'5 of 6 photos loaded. 1 could not load'}).waitFor();
      assert.equal(await page.locator('#photoLoadStatus').getAttribute('class'),'msg error');
      fail=false;await page.locator('#retryPhotosBtn').click();
      await page.locator('#photoLoadStatus').filter({hasText:'all 6 photos have loaded successfully'}).waitFor();
      assert.equal(calls['/2'],2);assert.equal(calls['/0'],1);assert.equal(calls['/5'],1);
      assert(await page.locator('#retryPhotosBtn').isHidden());
    });
    await check('upload completion is visible, counts duplicates, and never calls failures successful',async page=>{
      await page.route('https://script.google.com/**',async route=>{
        const payload=route.request().postDataJSON();
        let result;
        if(payload.action==='admin_add_gallery_image') {
          await new Promise(resolve=>setTimeout(resolve,80));
          result=payload.file_name==='bad.jpg'?{success:false,error:'Test failure'}:{success:true,duplicate:payload.file_name==='duplicate.jpg'};
        } else result=backend.post(payload);
        await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
      });
      await page.goto('https://studio.test/admin.html');
      await page.locator('#gateToken').fill('admin-secret');await page.locator('#loginBtn').click();
      await page.getByRole('button',{name:'Client Galleries',exact:true}).click();
      await page.getByRole('button',{name:'Modify Files',exact:true}).first().click();
      const input=names=>names.map(name=>({name,mimeType:'image/jpeg',buffer:photo}));
      await page.locator('#galleryUploadInput').setInputFiles(input(['new.jpg','duplicate.jpg']));
      await page.locator('#clientUploadButton').click();
      await page.locator('#galleryUploadSummary').filter({hasText:'all 2 selected photos are saved'}).waitFor();
      assert.match(await page.locator('#galleryUploadSummary').innerText(),/1 newly uploaded; 1 already present; no upload errors/);
      assert(await page.locator('#lastGalleryUpload').isVisible());
      await page.locator('#galleryUploadInput').setInputFiles(input(['bad.jpg']));
      await page.locator('#clientUploadButton').click();
      await page.locator('#galleryUploadSummary').filter({hasText:'Upload finished with errors'}).waitFor();
      assert.equal(await page.locator('#galleryUploadSummary').getAttribute('class'),'msg error');
      assert.match(await page.locator('#lastGalleryUpload').innerText(),/1 failed/);
    });
  } finally {await browser.close();}
  process.exitCode=failures?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
