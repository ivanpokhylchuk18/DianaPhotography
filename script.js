/* ═══════════════════════════════════════════════════════════════════════════
   script.js — Diana Obermeyer Photography (Full)
   ═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyKQjD9xQvt4fBl3z79dMEP3nU8f6qXLBrtS2cFLHa7897kHnzbtHm66WdBfhT3T1rx/exec";

  // --- 1. NAVBAR SCROLL ---
  const navbar = document.getElementById('navbar');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (navbar) {
    function updateNavbar() { window.scrollY > 60 ? navbar.classList.add('scrolled') : navbar.classList.remove('scrolled'); }
    window.addEventListener('scroll', updateNavbar, { passive: true });
    updateNavbar();
  }

  // --- 2. MOBILE MENU ---
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileLinks = mobileMenu ? Array.from(mobileMenu.querySelectorAll('a')) : [];
  function openMenu() {
    hamburger.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true');
    mobileMenu.classList.add('open');
    mobileMenu.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    hamburger.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    mobileMenu.classList.remove('open');
    mobileMenu.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => { mobileMenu.classList.contains('open') ? closeMenu() : openMenu(); });
    mobileLinks.forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mobileMenu.classList.contains('open')) { closeMenu(); hamburger.focus(); } });
  }

  // --- 3. SCROLL REVEAL ---
  const revealElements = document.querySelectorAll('.reveal');
  if (prefersReducedMotion) {
    revealElements.forEach((el) => el.classList.add('visible'));
  } else if (revealElements.length > 0 && 'IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('visible'); revealObserver.unobserve(entry.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealElements.forEach((el) => revealObserver.observe(el));
  } else { revealElements.forEach((el) => el.classList.add('visible')); }

  // --- 4. HERO PARALLAX ---
  const heroImage = document.querySelector('.hero-img-tag');
  if (heroImage && !prefersReducedMotion) {
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => { heroImage.style.transform = `translateY(${window.scrollY * 0.3}px)`; ticking = false; });
        ticking = true;
      }
    }, { passive: true });
  }

  // --- 5. SMOOTH SCROLL ---
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const navHeight = navbar ? navbar.offsetHeight : 0;
        const targetTop = target.getBoundingClientRect().top + window.scrollY - navHeight - 20;
        window.scrollTo({ top: targetTop, behavior: 'smooth' });
      }
    });
  });

  // --- 6. PORTFOLIO HOVER TILT (applied to image items) ---
  function applyTiltEffect(elements) {
    elements.forEach((item) => {
      item.addEventListener('mousemove', (e) => {
        const rect = item.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = (y - centerY) / centerY * -3;
        const rotateY = (x - centerX) / centerX * 3;
        item.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.01)`;
      });
      item.addEventListener('mouseleave', () => { item.style.transform = ''; });
    });
  }

  // --- 7. STATS COUNTER ---
  const statNums = document.querySelectorAll('.stat-num');
  function animateCount(el, target, suffix = '') {
    if (prefersReducedMotion) { el.textContent = `${target}${suffix}`; return; }
    const duration = 1800;
    const startTime = performance.now();
    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(0 + (target - 0) * eased);
      el.textContent = current + suffix;
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }
  if (statNums.length > 0 && 'IntersectionObserver' in window) {
    const statsObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          statNums.forEach((el) => {
            const raw = el.textContent.trim();
            const suffix = raw.includes('%') ? '%' : '';
            const num = parseInt(raw.replace(/\D/g, ''), 10);
            if (!isNaN(num)) animateCount(el, num, suffix);
          });
          statsObserver.disconnect();
        }
      });
    }, { threshold: 0.5 });
    const statsStrip = document.querySelector('.stats-strip');
    if (statsStrip) statsObserver.observe(statsStrip);
  }

  // --- 8. LAZY LOAD FADE ---
  const lazyImages = document.querySelectorAll('img[loading="lazy"]');
  lazyImages.forEach((img) => {
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.6s ease';
    if (img.complete) img.style.opacity = '1';
    else { img.addEventListener('load', () => { img.style.opacity = '1'; }); img.addEventListener('error', () => { img.style.opacity = '1'; }); }
  });

  // --- 9. ACTIVE NAV LINK ---
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.nav-links a:not(.nav-cta)');
  navLinks.forEach((link) => { if (link.getAttribute('href') === currentPath || (currentPath === '' && link.getAttribute('href') === 'index.html')) link.classList.add('active'); });

  // --- 10. BOOKING WIZARD (unchanged) ---
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    const step1 = document.getElementById('wizard-step-1');
    const step2 = document.getElementById('wizard-step-2');
    const step3 = document.getElementById('wizard-step-3');
    const successScreen = document.getElementById('wizard-success');
    const progressTracking = document.querySelector('.wizard-progress');
    const badge1 = document.getElementById('step-badge-1');
    const badge2 = document.getElementById('step-badge-2');
    const badge3 = document.getElementById('step-badge-3');
    const sessionCards = document.querySelectorAll('.session-card');
    const sessionInput = document.getElementById('session_type');
    const nextBtn2 = document.getElementById('nextBtn-2');
    const prevBtn2 = document.getElementById('prevBtn-2');
    const prevBtn3 = document.getElementById('prevBtn-3');
    const heading2 = document.getElementById('step-2-heading');
    const previewContainer = document.getElementById('preview-container');
    let customCalendarInstance = null;

    function initializePremiumCalendar(disabledDatesArray = []) {
      if (typeof flatpickr !== 'undefined') {
        customCalendarInstance = flatpickr("#preferred_date", {
          dateFormat: "Y-m-d", minDate: "today", disable: disabledDatesArray,
          locale: { firstDayOfWeek: 1 },
          onChange: function(selectedDates, dateStr) { console.log("Selected target date slot:", dateStr); }
        });
      }
    }
    async function fetchStudioAvailability() {
      try {
        const response = await fetch(APPS_SCRIPT_URL);
        const data = await response.json();
        if (data.success && data.bookedDates) { initializePremiumCalendar(data.bookedDates); }
        else { initializePremiumCalendar([]); }
      } catch (err) { initializePremiumCalendar([]); }
    }
    fetchStudioAvailability();

    sessionCards.forEach(card => {
      card.addEventListener('click', () => {
        sessionCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const selection = card.getAttribute('data-value');
        sessionInput.value = selection;
        heading2.textContent = `Tell me about your ${selection.toLowerCase()} session`;
        setTimeout(() => { goToStep(2); }, 350);
      });
    });
    prevBtn2.addEventListener('click', () => goToStep(1));
    prevBtn3.addEventListener('click', () => goToStep(2));
    nextBtn2.addEventListener('click', () => {
      const inputs = step2.querySelectorAll('input[required], textarea[required]');
      let allValid = true;
      inputs.forEach(input => { if (!input.checkValidity()) { input.reportValidity(); allValid = false; } });
      if (allValid) { generatePreview(); goToStep(3); }
    });
    function goToStep(stepNum) {
      step1.classList.remove('active'); step2.classList.remove('active'); step3.classList.remove('active');
      const badges = [badge1, badge2, badge3];
      badges.forEach(b => { if (b) { b.style.color = 'var(--stone)'; b.style.fontWeight = '400'; b.style.borderBottom = 'none'; b.style.opacity = '0.4'; } });
      if (stepNum === 1) { step1.classList.add('active'); badge1.style.color = 'var(--gold)'; badge1.style.fontWeight = '600'; badge1.style.borderBottom = '2px solid var(--gold)'; badge1.style.opacity = '1'; }
      else if (stepNum === 2) { step2.classList.add('active'); badge2.style.color = 'var(--gold)'; badge2.style.fontWeight = '600'; badge2.style.borderBottom = '2px solid var(--gold)'; badge2.style.opacity = '1'; }
      else if (stepNum === 3) { step3.classList.add('active'); badge3.style.color = 'var(--gold)'; badge3.style.fontWeight = '600'; badge3.style.borderBottom = '2px solid var(--gold)'; badge3.style.opacity = '1'; }
    }
    function generatePreview() {
      const formData = new FormData(contactForm);
      previewContainer.innerHTML = `<div><strong>Session Selection:</strong> ${formData.get('session_type')}</div><div><strong>Full Name:</strong> ${formData.get('name')}</div><div><strong>Email Address:</strong> ${formData.get('email')}</div><div><strong>Phone Number:</strong> ${formData.get('phone') || 'Not provided'}</div><div><strong>Requested Date:</strong> ${formData.get('preferred_date')}</div><div><strong>Location / Venue:</strong> ${formData.get('location') || 'Not provided'}</div><div style="margin-top: 0.75rem; border-top: 1px solid rgba(44,44,44,0.08); padding-top: 0.75rem;"><strong>Vision Details & Notes:</strong><br>${(formData.get('message') || '').replace(/\n/g, '<br>')}</div>`;
    }
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('submitBtn');
      submitBtn.textContent = 'Securing Your Date...';
      submitBtn.disabled = true;
      const formData = new FormData(contactForm);
      const payload = {
        name: formData.get('name'), email: formData.get('email'), phone: formData.get('phone'),
        session_type: formData.get('session_type'), preferred_date: formData.get('preferred_date'),
        location: formData.get('location'), message: formData.get('message')
      };
      try {
        const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', mode: 'cors', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain' } });
        const result = await response.json();
        if (result.success) {
          document.getElementById('success-ref-id').textContent = result.booking_id;
          contactForm.style.display = 'none';
          progressTracking.style.display = 'none';
          successScreen.style.display = 'block';
          successScreen.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else { throw new Error(result.error || 'Server rejection.'); }
      } catch (err) {
        alert(`Submission issue: ${err.message}. Please email dianaobermeyerphotogrpahy@gmail.com directly.`);
        submitBtn.textContent = 'Submit Booking Request';
        submitBtn.disabled = false;
      }
    });
  }

  // --- 11. FOLDER-BASED PORTFOLIO LOADER ---
  const folderGrid = document.getElementById('folderDirectoryGrid');
  const imageGrid = document.getElementById('dynamicPortfolioGrid');
  const folderBackRow = document.getElementById('folderBackRow');
  const backBtn = document.getElementById('backToFoldersBtn');

  if (folderGrid && imageGrid) {
    let allImages = [];
    let currentCategory = null;
    const localPortfolioImages = [
      { photo_url: "images/Weddings%20Portraits-20260822T183305Z-1-001/Weddings%20Portraits/IMG_2843.jpg", category: "weddings", alt_text: "Wedding celebration", caption: "Weddings" },
      { photo_url: "images/Weddings%20Portraits-20260822T183305Z-1-001/Weddings%20Portraits/IMG_3205.jpg", category: "weddings", alt_text: "Wedding portrait", caption: "Weddings" },
      { photo_url: "images/Engagement%20Portraits-20260822T183310Z-1-001/Engagement%20Portraits/IMG_3925.jpg", category: "engagements", alt_text: "Engagement portrait", caption: "Engagements" },
      { photo_url: "images/Engagement%20Portraits-20260822T183310Z-1-001/Engagement%20Portraits/IMG_5804.jpg", category: "engagements", alt_text: "Couple portrait", caption: "Engagements" },
      { photo_url: "images/Family%20Portraits-20260822T183309Z-1-001/Family%20Portraits/IMG_1338.jpg", category: "family-portraits", alt_text: "Family portrait", caption: "Family Portraits" },
      { photo_url: "images/Family%20Portraits-20260822T183309Z-1-001/Family%20Portraits/IMG_1912.jpg", category: "family-portraits", alt_text: "Family outdoors", caption: "Family Portraits" },
      { photo_url: "images/Maternity%20Portraits-20260822T183308Z-1-001/Maternity%20Portraits/IMG_7000.jpg", category: "maternity-portraits", alt_text: "Maternity portrait", caption: "Maternity Portraits" },
      { photo_url: "images/Maternity%20Portraits-20260822T183308Z-1-001/Maternity%20Portraits/IMG_7066.jpg", category: "maternity-portraits", alt_text: "Maternity session", caption: "Maternity Portraits" },
      { photo_url: "images/Children%27s%20Portraits-20260822T183310Z-1-001/Children_s%20Portraits/IMG_0243.jpg", category: "childrens-portraits", alt_text: "Children's portrait", caption: "Children's Portraits" },
      { photo_url: "images/Children%27s%20Portraits-20260822T183310Z-1-001/Children_s%20Portraits/IMG_0322.jpg", category: "childrens-portraits", alt_text: "Children playing outdoors", caption: "Children's Portraits" },
      { photo_url: "images/Senior%20Portraits-20260822T183307Z-1-001/Senior%20Portraits/IMG_0312.jpg", category: "senior-portraits", alt_text: "Senior portrait", caption: "Senior Portraits" },
      { photo_url: "images/Senior%20Portraits-20260822T183307Z-1-001/Senior%20Portraits/IMG_0459.jpg", category: "senior-portraits", alt_text: "Senior portrait outdoors", caption: "Senior Portraits" }
    ];

    async function loadPortfolioFolders() {
      allImages = localPortfolioImages;
      renderPortfolioFolders();
      try {
        const res = await fetch(`${APPS_SCRIPT_URL}?action=gallery`);
        const data = await res.json();
        if (data.success && Array.isArray(data.data) && data.data.length) {
          allImages = [...localPortfolioImages, ...data.data];
          renderPortfolioFolders();
        }
      } catch(e) {
        console.error(e);
      }
    }

    function renderPortfolioFolders() {
      const categories = {};
      allImages.forEach(img => {
        const cat = img.category || 'uncategorized';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(img);
      });
      renderFolderCards(categories);
    }

    function renderFolderCards(categories) {
      folderGrid.innerHTML = '';
      const categoryTitles = {
        weddings: 'Weddings',
        engagements: 'Engagements',
        portraits: 'Portraits',
        'family-portraits': 'Family Portraits',
        'maternity-portraits': 'Maternity Portraits',
        'childrens-portraits': "Children's Portraits",
        'senior-portraits': 'Senior Portraits',
        uncategorized: 'Other Work'
      };
      for (const [cat, images] of Object.entries(categories)) {
        const card = document.createElement('div');
        card.className = 'portfolio-folder-card';
        card.innerHTML = `
          <img class="portfolio-folder-cover" src="${images[0].photo_url}" alt="${categoryTitles[cat] || cat} collection cover" loading="lazy">
          <h3>${categoryTitles[cat] || cat}</h3>
          <p>${images.length} photograph${images.length !== 1 ? 's' : ''}</p>
        `;
        card.addEventListener('click', () => showCategoryImages(cat, categoryTitles[cat] || cat));
        folderGrid.appendChild(card);
      }
    }

    function showCategoryImages(category, displayName) {
      currentCategory = category;
      const filtered = allImages.filter(img => (img.category || 'uncategorized') === category);
      renderImageGrid(filtered, displayName);
      folderGrid.style.display = 'none';
      imageGrid.style.display = 'grid';
      folderBackRow.style.display = 'block';
      // Scroll to top of grid
      imageGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderImageGrid(images, categoryName) {
      imageGrid.innerHTML = '';
      if (images.length === 0) {
        imageGrid.innerHTML = '<p>No images in this collection.</p>';
        return;
      }
      images.forEach(img => {
        const item = document.createElement('a');
        item.href = '#';
        item.className = 'portfolio-item';
        item.setAttribute('data-category', img.category);
        item.innerHTML = `<img src="${img.photo_url}" alt="${img.alt_text || img.caption || categoryName}" loading="lazy"><div class="portfolio-overlay"><span class="portfolio-label">${img.caption || categoryName}</span></div>`;
        
        // Add click handler to open lightbox
        item.addEventListener('click', (e) => {
          e.preventDefault();
          openLightbox(img.photo_url, img.caption || categoryName);
        });
        
        imageGrid.appendChild(item);
      });
      // Apply hover tilt effect to new items
      const newItems = document.querySelectorAll('#dynamicPortfolioGrid .portfolio-item');
      applyTiltEffect(Array.from(newItems));
    }

    function resetToFolderView() {
      folderGrid.style.display = 'grid';
      imageGrid.style.display = 'none';
      folderBackRow.style.display = 'none';
      currentCategory = null;
      // Optionally re-render folders in case data changed
      loadPortfolioFolders();
    }

    if (backBtn) backBtn.addEventListener('click', resetToFolderView);

    loadPortfolioFolders();
  }

  // Apply tilt to any existing portfolio items on other pages (index, etc.)
  const existingPortfolioItems = document.querySelectorAll('.portfolio-item');
  if (existingPortfolioItems.length) applyTiltEffect(Array.from(existingPortfolioItems));

});

/* ════════════════════════════════════════════════════════════════════════════
   LIGHTBOX FUNCTIONS (Global - outside DOMContentLoaded)
   ════════════════════════════════════════════════════════════════════════════ */

function openLightbox(imageUrl, caption) {
  const lightbox = document.getElementById('imageLightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxCaption = document.getElementById('lightboxCaption');
  
  if (lightbox && lightboxImage) {
    lightboxImage.src = imageUrl;
    lightboxCaption.textContent = caption;
    lightbox.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    // Close lightbox on Escape key
    document.addEventListener('keydown', handleLightboxKeydown);
  }
}

function closeLightbox() {
  const lightbox = document.getElementById('imageLightbox');
  if (lightbox) {
    lightbox.style.display = 'none';
    document.body.style.overflow = '';
    document.removeEventListener('keydown', handleLightboxKeydown);
  }
}

function handleLightboxKeydown(e) {
  if (e.key === 'Escape') {
    closeLightbox();
  }
}