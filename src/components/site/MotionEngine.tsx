'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

// Um só motor para entradas e animações em loop: observa, aplica classes e descansa.
export function MotionEngine() {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            reveal.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    );
    const live = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle('live', entry.isIntersecting);
    });
    document.querySelectorAll('[data-reveal]:not(.in)').forEach((el) => reveal.observe(el));
    document.querySelectorAll('[data-live], .section').forEach((el) => live.observe(el));

    const onVisibility = () => document.body.classList.toggle('paused', document.hidden);
    document.addEventListener('visibilitychange', onVisibility);

    let frame = 0;
    let lastWidth = -1;
    const paint = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - innerHeight;
      const width = max > 0 ? Math.round((scrollY / max) * 1000) / 1000 : 0;
      if (width !== lastWidth && barRef.current) {
        lastWidth = width;
        barRef.current.style.transform = `scaleX(${width})`;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    addEventListener('scroll', onScroll, { passive: true });
    paint();

    return () => {
      reveal.disconnect();
      live.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return <div className="scan-progress" ref={barRef} aria-hidden="true" />;
}
