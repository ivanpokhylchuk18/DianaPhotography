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
     10. CONTACT FORM (if exists on this page)
         Handles form submission via Formspree
     ══════════════════════════════════════════════════════════════════════════ */

  const contactForm = document.getElementById('contactForm');

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn  = contactForm.querySelector('[type="submit"]');
      const formData   = new FormData(contactForm);
      const formAction = contactForm.action || contactForm.getAttribute('action'); // Your Formspree endpoint

      if (!submitBtn || !formAction) return;

      // Update button state
      submitBtn.textContent = 'Sending...';
      submitBtn.disabled    = true;

      try {
        const response = await fetch(formAction, {
          method: 'POST',
          body:   formData,
          headers: { 'Accept': 'application/json' },
        });

        if (response.ok) {
          // Success state
          showFormMessage(contactForm, 'success',
            'Your message was sent! I\'ll be in touch within 48 hours.');
          contactForm.reset();
        } else {
          throw new Error('Submission failed');
        }
      } catch (err) {
        showFormMessage(contactForm, 'error',
          'Something went wrong. Please email me directly at hello@ariasommers.com');
      } finally {
        submitBtn.textContent = 'Send Message';
        submitBtn.disabled    = false;
      }
    });
  }

  function showFormMessage(form, type, message) {
    // Remove any existing message
    const existing = form.querySelector('.form-message');
    if (existing) existing.remove();

    const msg = document.createElement('p');
    msg.className  = `form-message ${type}`;
    msg.textContent = message;
    form.appendChild(msg);
  }

}); // end DOMContentLoaded
