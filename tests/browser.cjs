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
  } finally {await browser.close();}
  process.exitCode=failures?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
