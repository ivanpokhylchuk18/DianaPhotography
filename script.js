/* ═══════════════════════════════════════════════════════════════════════════
   script.js — Aria Sommers Photography
   ═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ══════════════════════════════════════════════════════════════════════════
     1. NAVBAR — scroll state + transparent-to-solid transition
     ══════════════════════════════════════════════════════════════════════════ */

  const navbar = document.getElementById('navbar');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!navbar) return;

  function updateNavbar() {
    if (window.scrollY > 60) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', updateNavbar, { passive: true });
  updateNavbar(); // Run once on load in case page is already scrolled


  /* ══════════════════════════════════════════════════════════════════════════
     2. MOBILE MENU — hamburger toggle
     ══════════════════════════════════════════════════════════════════════════ */

  const hamburger   = document.getElementById('hamburger');
  const mobileMenu  = document.getElementById('mobileMenu');
  const mobileLinks = mobileMenu ? Array.from(mobileMenu.querySelectorAll('a')) : [];

  function openMenu() {
    hamburger.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true');
    mobileMenu.classList.add('open');
    mobileMenu.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
  }

  function closeMenu() {
    hamburger.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    mobileMenu.classList.remove('open');
    mobileMenu.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.contains('open');
      isOpen ? closeMenu() : openMenu();
    });

    // Close menu when a link is clicked
    mobileLinks.forEach(link => {
      link.addEventListener('click', closeMenu);
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
        closeMenu();
        hamburger.focus();
      }
    });
  }


  /* ══════════════════════════════════════════════════════════════════════════
     3. SCROLL REVEAL — fade-up animation for .reveal elements
     ══════════════════════════════════════════════════════════════════════════ */

  const revealElements = document.querySelectorAll('.reveal');

  if (prefersReducedMotion) {
    revealElements.forEach((el) => el.classList.add('visible'));
  } else if (revealElements.length > 0 && 'IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            revealObserver.unobserve(entry.target); // Only animate once
          }
        });
      },
      {
        threshold: 0.12,
        rootMargin: '0px 0px -40px 0px',
      }
    );

    revealElements.forEach((el) => revealObserver.observe(el));
  } else {
    // Fallback: just show everything if IntersectionObserver not supported
    revealElements.forEach((el) => el.classList.add('visible'));
  }


  /* ══════════════════════════════════════════════════════════════════════════
     4. HERO PARALLAX — subtle depth on scroll
     ══════════════════════════════════════════════════════════════════════════ */

  const heroImage = document.querySelector('.hero-img-tag');

  if (heroImage && !prefersReducedMotion) {
    let ticking = false;

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          // Move image slightly slower than scroll for parallax depth
          heroImage.style.transform = `translateY(${scrollY * 0.3}px)`;
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }


  /* ══════════════════════════════════════════════════════════════════════════
     5. SMOOTH SCROLL — for any anchor links pointing to page sections
     ══════════════════════════════════════════════════════════════════════════ */

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


  /* ══════════════════════════════════════════════════════════════════════════
     6. PORTFOLIO HOVER TILT — subtle 3D card tilt effect
        Optional: remove if you prefer the simpler hover
     ══════════════════════════════════════════════════════════════════════════ */

  const portfolioItems = document.querySelectorAll('.portfolio-item');

  portfolioItems.forEach((item) => {
    item.addEventListener('mousemove', (e) => {
      const rect   = item.getBoundingClientRect();
      const x      = e.clientX - rect.left;
      const y      = e.clientY - rect.top;
      const centerX = rect.width  / 2;
      const centerY = rect.height / 2;
      const rotateX = (y - centerY) / centerY * -3; // Max 3deg tilt
      const rotateY = (x - centerX) / centerX *  3;

      item.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.01)`;
    });

    item.addEventListener('mouseleave', () => {
      item.style.transform = '';
    });
  });


  /* ══════════════════════════════════════════════════════════════════════════
     7. STATS COUNTER ANIMATION — counts up when strip enters viewport
     ══════════════════════════════════════════════════════════════════════════ */

  const statNums = document.querySelectorAll('.stat-num');

  function animateCount(el, target, suffix = '') {
    if (prefersReducedMotion) {
      el.textContent = `${target}${suffix}`;
      return;
    }

    const duration = 1800;
    const startTime = performance.now();
    const startVal = 0;

    function update(currentTime) {
      const elapsed  = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (target - startVal) * eased);
      el.textContent = current + suffix;
      if (progress < 1) requestAnimationFrame(update);
    }

    requestAnimationFrame(update);
  }

  if (statNums.length > 0 && 'IntersectionObserver' in window) {
    const statsObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            statNums.forEach((el) => {
              const raw    = el.textContent.trim();
              const suffix = raw.includes('%') ? '%' : '';
              const num    = parseInt(raw.replace(/\D/g, ''), 10);
              if (!isNaN(num)) animateCount(el, num, suffix);
            });
            statsObserver.disconnect(); // Only animate once
          }
        });
      },
      { threshold: 0.5 }
    );

    const statsStrip = document.querySelector('.stats-strip');
    if (statsStrip) statsObserver.observe(statsStrip);
  }


  /* ══════════════════════════════════════════════════════════════════════════
     8. IMAGE LAZY LOAD — graceful fade-in when images load
     ══════════════════════════════════════════════════════════════════════════ */

  const lazyImages = document.querySelectorAll('img[loading="lazy"]');

  lazyImages.forEach((img) => {
    img.style.opacity   = '0';
    img.style.transition = 'opacity 0.6s ease';

    if (img.complete) {
      img.style.opacity = '1';
    } else {
      img.addEventListener('load', () => { img.style.opacity = '1'; });
      img.addEventListener('error', () => { img.style.opacity = '1'; }); // Don't hide broken imgs
    }
  });


  /* ══════════════════════════════════════════════════════════════════════════
     9. ACTIVE NAV LINK — highlight current page in navbar
     ══════════════════════════════════════════════════════════════════════════ */

  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks    = document.querySelectorAll('.nav-links a:not(.nav-cta)');

  navLinks.forEach((link) => {
    const linkPath = link.getAttribute('href');
    if (linkPath === currentPath || (currentPath === '' && linkPath === 'index.html')) {
      link.classList.add('active');
    }
  });


  /* ══════════════════════════════════════════════════════════════════════════
     10. MULTI-STEP LUXURY BOOKING WIZARD + LIVE CALENDAR AVAILABILITY
     ══════════════════════════════════════════════════════════════════════════ */
  const contactForm = document.getElementById('contactForm');

  if (contactForm) {
    const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzXAzeBYwY-hKuAGcVaWo32raHnTwcrBbx6p39hAjOpfkYTLmurypRkjOXgK4VGuE2t/exec"; 

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

    // Initialize Premium Calendar with Auto-Live Availability System
    function initializePremiumCalendar(disabledDatesArray = []) {
      customCalendarInstance = flatpickr("#preferred_date", {
        dateFormat: "Y-m-d",
        minDate: "today", // Prevents picking historical dates
        disable: disabledDatesArray, // Auto-locks dates returned from your Google Sheet row scan
        locale: { firstDayOfWeek: 1 },
        onChange: function(selectedDates, dateStr) {
          console.log("Selected target date slot:", dateStr);
        }
      });
    }

    // Pre-Fetch Booked Dates via GET Pipeline on Boot
    async function fetchStudioAvailability() {
      try {
        const response = await fetch(APPS_SCRIPT_URL);
        const data = await response.json();
        if (data.success && data.bookedDates) {
          console.log("Loaded unavailable dates directly from Google Sheets:", data.bookedDates);
          initializePremiumCalendar(data.bookedDates);
        } else {
          initializePremiumCalendar([]);
        }
      } catch (err) {
        console.warn("Could not sync live availability rows, running offline configuration mode:", err);
        initializePremiumCalendar([]);
      }
    }
    
    // Trigger live background fetch immediately
    fetchStudioAvailability();

    // Step 1: Selection Cards Logic
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
      
      inputs.forEach(input => {
        if (!input.checkValidity()) {
          input.reportValidity();
          allValid = false;
        }
      });

      if (allValid) {
        generatePreview();
        goToStep(3);
      }
    });

    function goToStep(stepNum) {
      step1.classList.remove('active');
      step2.classList.remove('active');
      step3.classList.remove('active');

      const badges = [badge1, badge2, badge3];
      badges.forEach(b => {
        if (b) {
          b.style.color = 'var(--stone)';
          b.style.fontWeight = '400';
          b.style.borderBottom = 'none';
          b.style.opacity = '0.4';
        }
      });

      if (stepNum === 1) {
        step1.classList.add('active');
        badge1.style.color = 'var(--gold)';
        badge1.style.fontWeight = '600';
        badge1.style.borderBottom = '2px solid var(--gold)';
        badge1.style.opacity = '1';
      } else if (stepNum === 2) {
        step2.classList.add('active');
        badge2.style.color = 'var(--gold)';
        badge2.style.fontWeight = '600';
        badge2.style.borderBottom = '2px solid var(--gold)';
        badge2.style.opacity = '1';
      } else if (stepNum === 3) {
        step3.classList.add('active');
        badge3.style.color = 'var(--gold)';
        badge3.style.fontWeight = '600';
        badge3.style.borderBottom = '2px solid var(--gold)';
        badge3.style.opacity = '1';
      }
    }

    function generatePreview() {
      const formData = new FormData(contactForm);
      previewContainer.innerHTML = `
        <div><strong>Session Selection:</strong> ${formData.get('session_type')}</div>
        <div><strong>Full Name:</strong> ${formData.get('name')}</div>
        <div><strong>Email Address:</strong> ${formData.get('email')}</div>
        <div><strong>Phone Number:</strong> ${formData.get('phone') || 'Not provided'}</div>
        <div><strong>Requested Date:</strong> ${formData.get('preferred_date')}</div>
        <div><strong>Location / Venue:</strong> ${formData.get('location') || 'Not provided'}</div>
        <div style="margin-top: 0.75rem; border-top: 1px solid rgba(44,44,44,0.08); padding-top: 0.75rem;">
          <strong>Vision Details & Notes:</strong><br>${formData.get('message').replace(/\n/g, '<br>')}
        </div>
      `;
    }

    // Transmission Protocol & Inline Success Routing
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('submitBtn');

      submitBtn.textContent = 'Securing Your Date...';
      submitBtn.disabled = true;

      const formData = new FormData(contactForm);
      const payload = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        session_type: formData.get('session_type'),
        preferred_date: formData.get('preferred_date'),
        location: formData.get('location'),
        message: formData.get('message')
      };

      try {
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          mode: 'cors',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'text/plain' }
        });

        const result = await response.json();

        if (result.success) {
          // Display reference ID onto editorial success block
          document.getElementById('success-ref-id').textContent = result.booking_id;
          
          // Smooth UI Swap
          contactForm.style.display = 'none';
          progressTracking.style.display = 'none';
          successScreen.style.display = 'block';
          
          // Auto scroll to top of inquiry window smoothly
          successScreen.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          throw new Error(result.error || 'The server rejected the inquiry structure.');
        }
      } catch (err) {
        console.error("Submission Error Details:", err);
        alert(`Submission issue: ${err.message}. Please reach out to hello@dianaobermeyer.com.`);
        submitBtn.textContent = 'Submit Booking Request';
        submitBtn.disabled = false;
      }
    });
  }

}); // end DOMContentLoaded
