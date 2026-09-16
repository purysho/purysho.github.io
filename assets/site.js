(() => {
  const reveal = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        reveal.unobserve(entry.target);
      }
    });
  }, { threshold: .12 });
  document.querySelectorAll('[data-reveal]').forEach(el => reveal.observe(el));

  const frame = document.getElementById('markFrame');
  if (frame && matchMedia('(pointer:fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.addEventListener('pointermove', e => {
      const x = (e.clientX / innerWidth - .5) * 9;
      const y = (e.clientY / innerHeight - .5) * -7;
      frame.style.transform = `rotateY(${x}deg) rotateX(${y}deg) translateZ(0)`;
    }, { passive:true });
  }
})();
